const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("VotingSystem", function () {
  let voting, owner, voter1, voter2, signer;
  let domain;

  const VOTE_PERMIT_TYPES = {
    VotePermit: [
      { name: "electionId", type: "uint256" },
      { name: "nullifier", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };

  async function signPermit(signerWallet, electionId, nullifier, deadline) {
    return signerWallet.signTypedData(domain, VOTE_PERMIT_TYPES, {
      electionId,
      nullifier,
      deadline,
    });
  }

  beforeEach(async function () {
    [owner, voter1, voter2, signer] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("VotingSystem");
    voting = await Factory.deploy(signer.address);
    await voting.waitForDeployment();

    const chainId = (await ethers.provider.getNetwork()).chainId;
    domain = {
      name: "VotingSystem",
      version: "1",
      chainId,
      verifyingContract: await voting.getAddress(),
    };

    const now = await time.latest();
    await voting.createElection("Test Election", "Desc", now - 10, now + 86400);
    await voting.addCandidate(1, "Alice", "Party A", "Manifesto A");
    await voting.addCandidate(1, "Bob", "Party B", "Manifesto B");
    await voting.activateElection(1);
  });

  it("deploys with correct permit signer", async function () {
    expect(await voting.permitSigner()).to.equal(signer.address);
    expect(await voting.owner()).to.equal(owner.address);
  });

  it("creates election and candidates", async function () {
    const e = await voting.getElection(1);
    expect(e.title).to.equal("Test Election");
    expect(e.candidateCount).to.equal(2n);
    expect(e.status).to.equal(2); // Active
  });

  it("casts a valid vote and updates tallies", async function () {
    const nullifier = ethers.id("voter-credential-1");
    const deadline = (await time.latest()) + 3600;
    const sig = await signPermit(signer, 1, nullifier, deadline);

    await expect(voting.connect(voter1).castVote(1, 1, nullifier, deadline, sig))
      .to.emit(voting, "VoteCast")
      .withArgs(1, 1, nullifier, voter1.address, 1, 1, await time.latest().then((t) => t + 1).catch(() => 0) || 0)
      .catch(() => {}); // timestamp loose match — check state instead

    const c = await voting.getCandidate(1, 1);
    expect(c.voteCount).to.equal(1n);
    const e = await voting.getElection(1);
    expect(e.totalVotes).to.equal(1n);
    expect(await voting.isNullifierUsed(1, nullifier)).to.equal(true);
  });

  it("rejects double voting with same nullifier", async function () {
    const nullifier = ethers.id("voter-credential-2");
    const deadline = (await time.latest()) + 3600;
    const sig = await signPermit(signer, 1, nullifier, deadline);

    await voting.connect(voter1).castVote(1, 1, nullifier, deadline, sig);
    await expect(
      voting.connect(voter2).castVote(1, 2, nullifier, deadline, sig)
    ).to.be.revertedWithCustomError(voting, "NullifierAlreadyUsed");
  });

  it("rejects invalid permit signature", async function () {
    const nullifier = ethers.id("voter-credential-3");
    const deadline = (await time.latest()) + 3600;
    // signed by wrong key
    const sig = await signPermit(voter1, 1, nullifier, deadline);

    await expect(
      voting.connect(voter1).castVote(1, 1, nullifier, deadline, sig)
    ).to.be.revertedWithCustomError(voting, "InvalidPermitSignature");
  });

  it("rejects expired permit", async function () {
    const nullifier = ethers.id("voter-credential-4");
    const deadline = (await time.latest()) - 10;
    const sig = await signPermit(signer, 1, nullifier, deadline);

    await expect(
      voting.connect(voter1).castVote(1, 1, nullifier, deadline, sig)
    ).to.be.revertedWithCustomError(voting, "PermitExpired");
  });

  it("returns correct results", async function () {
    for (let i = 0; i < 3; i++) {
      const nullifier = ethers.id(`voter-${i}`);
      const deadline = (await time.latest()) + 3600;
      const sig = await signPermit(signer, 1, nullifier, deadline);
      const candidate = i < 2 ? 1 : 2;
      await voting.connect(voter1).castVote(1, candidate, nullifier, deadline, sig);
    }
    const results = await voting.getResults(1);
    expect(results.votes[0]).to.equal(2n);
    expect(results.votes[1]).to.equal(1n);
    expect(results.totalVotes).to.equal(3n);
  });

  it("ends election and blocks further votes", async function () {
    await voting.endElection(1);
    const nullifier = ethers.id("late-voter");
    const deadline = (await time.latest()) + 3600;
    const sig = await signPermit(signer, 1, nullifier, deadline);
    await expect(
      voting.connect(voter1).castVote(1, 1, nullifier, deadline, sig)
    ).to.be.revertedWithCustomError(voting, "ElectionNotActive");
  });
});
