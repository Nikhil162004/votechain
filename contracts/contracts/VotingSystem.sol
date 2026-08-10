// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VotingSystem
 * @notice Tamper-proof decentralized e-voting with off-chain identity verification.
 *
 * Design:
 *  - A trusted backend verifies real-world identity and issues an EIP-712
 *    "voting permit" containing a nullifier (hash of voter credential + election).
 *  - Anyone can submit the permit + choice from any wallet. The nullifier is
 *    burned on-chain so the same credential cannot vote twice.
 *  - The on-chain vote is not linked to the real identity — only the nullifier
 *    and the casting address (which can be ephemeral) are public.
 *  - Tallies are stored on-chain and emitted via events for real-time audit.
 */
contract VotingSystem is ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────

    enum ElectionStatus {
        Draft,
        Registration,
        Active,
        Ended,
        Cancelled
    }

    struct Candidate {
        uint256 id;
        string name;
        string party;
        string manifesto;
        uint256 voteCount;
        bool exists;
    }

    struct Election {
        uint256 id;
        string title;
        string description;
        uint256 startTime;
        uint256 endTime;
        ElectionStatus status;
        uint256 candidateCount;
        uint256 totalVotes;
        bool exists;
    }

    // ─────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────

    address public owner;
    address public permitSigner; // backend service that signs voting permits

    uint256 public electionCount;

    mapping(uint256 => Election) public elections;
    mapping(uint256 => mapping(uint256 => Candidate)) public candidates; // electionId => candidateId => Candidate
    mapping(uint256 => mapping(bytes32 => bool)) public usedNullifiers; // electionId => nullifier => used
    mapping(address => bool) public admins;

    // EIP-712
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant VOTE_PERMIT_TYPEHASH =
        keccak256("VotePermit(uint256 electionId,bytes32 nullifier,uint256 deadline)");

    bytes32 private immutable _DOMAIN_SEPARATOR;
    uint256 private immutable _CACHED_CHAIN_ID;

    // ─────────────────────────────────────────────
    // Events (audited real-time tallies)
    // ─────────────────────────────────────────────

    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event PermitSignerUpdated(address indexed oldSigner, address indexed newSigner);

    event ElectionCreated(
        uint256 indexed electionId,
        string title,
        uint256 startTime,
        uint256 endTime,
        address indexed createdBy
    );
    event ElectionStatusChanged(uint256 indexed electionId, ElectionStatus oldStatus, ElectionStatus newStatus);
    event CandidateAdded(
        uint256 indexed electionId,
        uint256 indexed candidateId,
        string name,
        string party
    );

    event VoteCast(
        uint256 indexed electionId,
        uint256 indexed candidateId,
        bytes32 indexed nullifier,
        address caster,
        uint256 newCandidateTally,
        uint256 newTotalVotes,
        uint256 timestamp
    );

    event TallySnapshot(
        uint256 indexed electionId,
        uint256 totalVotes,
        uint256 timestamp
    );

    // ─────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────

    error NotOwner();
    error NotAdmin();
    error ElectionNotFound();
    error CandidateNotFound();
    error InvalidStatus();
    error ElectionNotActive();
    error ElectionNotStarted();
    error ElectionEnded();
    error NullifierAlreadyUsed();
    error PermitExpired();
    error InvalidPermitSignature();
    error InvalidAddress();
    error InvalidTimeRange();
    error EmptyString();
    error NoCandidates();

    // ─────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != owner && !admins[msg.sender]) revert NotAdmin();
        _;
    }

    modifier electionExists(uint256 electionId) {
        if (!elections[electionId].exists) revert ElectionNotFound();
        _;
    }

    // ─────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────

    constructor(address _permitSigner) {
        if (_permitSigner == address(0)) revert InvalidAddress();
        owner = msg.sender;
        permitSigner = _permitSigner;
        admins[msg.sender] = true;
        _CACHED_CHAIN_ID = block.chainid;
        _DOMAIN_SEPARATOR = _buildDomainSeparator();
        emit AdminAdded(msg.sender);
        emit PermitSignerUpdated(address(0), _permitSigner);
    }

    // ─────────────────────────────────────────────
    // Admin management
    // ─────────────────────────────────────────────

    function addAdmin(address admin) external onlyOwner {
        if (admin == address(0)) revert InvalidAddress();
        admins[admin] = true;
        emit AdminAdded(admin);
    }

    function removeAdmin(address admin) external onlyOwner {
        admins[admin] = false;
        emit AdminRemoved(admin);
    }

    function setPermitSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidAddress();
        address old = permitSigner;
        permitSigner = newSigner;
        emit PermitSignerUpdated(old, newSigner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        owner = newOwner;
    }

    // ─────────────────────────────────────────────
    // Election lifecycle
    // ─────────────────────────────────────────────

    function createElection(
        string calldata title,
        string calldata description,
        uint256 startTime,
        uint256 endTime
    ) external onlyAdmin returns (uint256 electionId) {
        if (bytes(title).length == 0) revert EmptyString();
        if (endTime <= startTime) revert InvalidTimeRange();

        electionId = ++electionCount;

        elections[electionId] = Election({
            id: electionId,
            title: title,
            description: description,
            startTime: startTime,
            endTime: endTime,
            status: ElectionStatus.Draft,
            candidateCount: 0,
            totalVotes: 0,
            exists: true
        });

        emit ElectionCreated(electionId, title, startTime, endTime, msg.sender);
    }

    function addCandidate(
        uint256 electionId,
        string calldata name,
        string calldata party,
        string calldata manifesto
    ) external onlyAdmin electionExists(electionId) returns (uint256 candidateId) {
        Election storage e = elections[electionId];
        if (e.status != ElectionStatus.Draft && e.status != ElectionStatus.Registration) {
            revert InvalidStatus();
        }
        if (bytes(name).length == 0) revert EmptyString();

        candidateId = ++e.candidateCount;
        candidates[electionId][candidateId] = Candidate({
            id: candidateId,
            name: name,
            party: party,
            manifesto: manifesto,
            voteCount: 0,
            exists: true
        });

        emit CandidateAdded(electionId, candidateId, name, party);
    }

    function openRegistration(uint256 electionId) external onlyAdmin electionExists(electionId) {
        Election storage e = elections[electionId];
        if (e.status != ElectionStatus.Draft) revert InvalidStatus();
        if (e.candidateCount == 0) revert NoCandidates();
        _setStatus(electionId, ElectionStatus.Registration);
    }

    function activateElection(uint256 electionId) external onlyAdmin electionExists(electionId) {
        Election storage e = elections[electionId];
        if (e.status != ElectionStatus.Draft && e.status != ElectionStatus.Registration) {
            revert InvalidStatus();
        }
        if (e.candidateCount == 0) revert NoCandidates();
        _setStatus(electionId, ElectionStatus.Active);
    }

    function endElection(uint256 electionId) external onlyAdmin electionExists(electionId) {
        Election storage e = elections[electionId];
        if (e.status != ElectionStatus.Active) revert InvalidStatus();
        _setStatus(electionId, ElectionStatus.Ended);
        emit TallySnapshot(electionId, e.totalVotes, block.timestamp);
    }

    function cancelElection(uint256 electionId) external onlyAdmin electionExists(electionId) {
        Election storage e = elections[electionId];
        if (e.status == ElectionStatus.Ended || e.status == ElectionStatus.Cancelled) {
            revert InvalidStatus();
        }
        _setStatus(electionId, ElectionStatus.Cancelled);
    }

    /// @notice Anyone can finalize an election after endTime has passed
    function finalizeIfExpired(uint256 electionId) external electionExists(electionId) {
        Election storage e = elections[electionId];
        if (e.status != ElectionStatus.Active) revert InvalidStatus();
        if (block.timestamp < e.endTime) revert ElectionNotEnded();
        _setStatus(electionId, ElectionStatus.Ended);
        emit TallySnapshot(electionId, e.totalVotes, block.timestamp);
    }

    error ElectionNotEnded();

    // ─────────────────────────────────────────────
    // Voting (core)
    // ─────────────────────────────────────────────

    /**
     * @notice Cast a vote using a backend-issued EIP-712 permit.
     * @param electionId   Target election
     * @param candidateId  Chosen candidate
     * @param nullifier    Unique bytes32 derived off-chain from voter credential + election
     * @param deadline     Permit expiry (unix timestamp)
     * @param signature    EIP-712 signature from permitSigner
     */
    function castVote(
        uint256 electionId,
        uint256 candidateId,
        bytes32 nullifier,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant electionExists(electionId) {
        Election storage e = elections[electionId];

        // Status + time window
        if (e.status != ElectionStatus.Active) revert ElectionNotActive();
        if (block.timestamp < e.startTime) revert ElectionNotStarted();
        if (block.timestamp > e.endTime) revert ElectionEnded();

        // Candidate
        Candidate storage c = candidates[electionId][candidateId];
        if (!c.exists) revert CandidateNotFound();

        // Nullifier (double-vote prevention)
        if (usedNullifiers[electionId][nullifier]) revert NullifierAlreadyUsed();

        // Permit expiry
        if (block.timestamp > deadline) revert PermitExpired();

        // Verify EIP-712 signature from trusted permit signer
        bytes32 structHash = keccak256(
            abi.encode(VOTE_PERMIT_TYPEHASH, electionId, nullifier, deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != permitSigner) revert InvalidPermitSignature();

        // Effects
        usedNullifiers[electionId][nullifier] = true;
        unchecked {
            c.voteCount += 1;
            e.totalVotes += 1;
        }

        emit VoteCast(
            electionId,
            candidateId,
            nullifier,
            msg.sender,
            c.voteCount,
            e.totalVotes,
            block.timestamp
        );
    }

    // ─────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────

    function getElection(uint256 electionId)
        external
        view
        electionExists(electionId)
        returns (
            uint256 id,
            string memory title,
            string memory description,
            uint256 startTime,
            uint256 endTime,
            ElectionStatus status,
            uint256 candidateCount,
            uint256 totalVotes
        )
    {
        Election storage e = elections[electionId];
        return (
            e.id,
            e.title,
            e.description,
            e.startTime,
            e.endTime,
            e.status,
            e.candidateCount,
            e.totalVotes
        );
    }

    function getCandidate(uint256 electionId, uint256 candidateId)
        external
        view
        electionExists(electionId)
        returns (
            uint256 id,
            string memory name,
            string memory party,
            string memory manifesto,
            uint256 voteCount
        )
    {
        Candidate storage c = candidates[electionId][candidateId];
        if (!c.exists) revert CandidateNotFound();
        return (c.id, c.name, c.party, c.manifesto, c.voteCount);
    }

    function getAllCandidates(uint256 electionId)
        external
        view
        electionExists(electionId)
        returns (Candidate[] memory)
    {
        Election storage e = elections[electionId];
        Candidate[] memory list = new Candidate[](e.candidateCount);
        for (uint256 i = 1; i <= e.candidateCount; i++) {
            list[i - 1] = candidates[electionId][i];
        }
        return list;
    }

    function getResults(uint256 electionId)
        external
        view
        electionExists(electionId)
        returns (
            uint256[] memory candidateIds,
            string[] memory names,
            string[] memory parties,
            uint256[] memory votes,
            uint256 totalVotes
        )
    {
        Election storage e = elections[electionId];
        uint256 n = e.candidateCount;
        candidateIds = new uint256[](n);
        names = new string[](n);
        parties = new string[](n);
        votes = new uint256[](n);

        for (uint256 i = 1; i <= n; i++) {
            Candidate storage c = candidates[electionId][i];
            candidateIds[i - 1] = c.id;
            names[i - 1] = c.name;
            parties[i - 1] = c.party;
            votes[i - 1] = c.voteCount;
        }
        totalVotes = e.totalVotes;
    }

    function isNullifierUsed(uint256 electionId, bytes32 nullifier) external view returns (bool) {
        return usedNullifiers[electionId][nullifier];
    }

    function domainSeparator() public view returns (bytes32) {
        if (block.chainid == _CACHED_CHAIN_ID) {
            return _DOMAIN_SEPARATOR;
        }
        return _buildDomainSeparator();
    }

    function getVotePermitTypehash() external pure returns (bytes32) {
        return VOTE_PERMIT_TYPEHASH;
    }

    // ─────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────

    function _setStatus(uint256 electionId, ElectionStatus newStatus) internal {
        Election storage e = elections[electionId];
        ElectionStatus old = e.status;
        e.status = newStatus;
        emit ElectionStatusChanged(electionId, old, newStatus);
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes("VotingSystem")),
                    keccak256(bytes("1")),
                    block.chainid,
                    address(this)
                )
            );
    }
}
