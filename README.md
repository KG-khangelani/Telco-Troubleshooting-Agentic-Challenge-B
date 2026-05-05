# Track B: Telco Troubleshooting and Optimization Agentic Challenge

## Competition Overview

This task focuses on IP network operations and maintenance. Participants are required to build intelligent agents that complete IP network fault diagnosis and troubleshooting tasks by calling the CLI simulation interfaces provided by the **Agent Tool Server**.

**Base Model:** The entire competition (Phase 1 / 2 / 3) uses **Qwen3.5-35B-A3B** as the base model. Participants may fine-tune the model (LoRA, full fine-tuning, etc.), but are not allowed to replace it with a different architecture or a model of a different parameter scale.

**Server Core Capabilities:**
- Simulates CLI interactions for network devices (Huawei / Cisco / H3C)
- Supports regex whitelist validation for 45+ command categories
- Faithfully reproduces vendor-level syntax errors (incomplete / unrecognized / ambiguous / wrong parameter)
- Multiple command output file types covering routing tables, BGP, VXLAN, SRv6, and more

---

## Competition Design

### Schedule Overview

| Phase | Name | Duration      | Purpose | Problem Scale & Requirements                     | Participant Actions                                                   |
|-------|------|---------------|---------|--------------------------------------------------|-----------------------------------------------------------------------|
| **Phase 1** | Open Practice | 3 April–4 May | Debug Agent, familiarize with API | 50 problems / Multi vendor / advanced protocols  | Run locally, submit result.csv                                        |
| **Phase 2** | Elimination Round | 4 May-18 May  | Select top participants for Phase 3 | 100 problems / multi-vendor / advanced protocols | Run locally, 1 submission only, upload execution trace and result.csv |
| **Phase 3** | Final | 18 May-29 May | Final ranking | 70 problems / multi-vendor / advanced protocols    | Server-side Docker auto-execution                                     |

### Detailed Problem Distribution

| Phase | Problem Composition                                                 | Task Types | Protocols Covered (examples, not exhaustive) | Device Vendors       |
|-------|---------------------------------------------------------------------|------------|-------------------------------|----------------------|
| **Phase 1** | 32-node financial network & 22-node cloud computing network (50 problems) | Topology reconstruction, path query, fault localization | +LLDP, OSPF, VXLAN            | **Multi-vendor mix** |
| **Phase 2** | 40-node campus network (100)                                        | Topology reconstruction, path query, fault localization | +VLAN, VRRP, MP-BGP           | **Multi-vendor mix** |
| **Phase 3** | 64-node financial network (70)                                      | Topology reconstruction, path query, fault localization | +VXLAN, EVPN, SRv6, ISIS, BGP | **Multi-vendor mix** |

### Phase 1 (Open Practice)

- **Number of Problems:** 50
- **Execution Environment:** Participants run Agent locally
- **Base Model:** Qwen3.5-35B-A3B (participants may fine-tune)
- **API Call Limit:** Max **1,000 API calls per participant per day** (only Phase 1 enforces this daily quota; Phase 2 and Phase 3 do not have this restriction)
- **Scoring:** Participants submit `result.csv`; scored by **accuracy only** (the sole evaluation metric for Phase 1)
- **Tool Call Rules:**
  - Agent must call tools **sequentially** when solving a single problem; no concurrent calls within a problem
  - Max concurrency per participant is **2** (i.e., at most 2 problems running in parallel)
- **Onboarding:** Server source code and local deployment guide provided to help participants deploy locally

### Phase 2 (Elimination Round)

- **Number of Problems:** 100
- **Base Model:** Qwen3.5-35B-A3B (participants may fine-tune)
- **Submission Limit:** Each participant is allowed **only three submissions**; execution trace must be uploaded to the server. Unlike Phase 1, there is no daily API call quota, but participants must ensure at least a single run completes successfully.
- **Scoring:** **Accuracy** as the primary metric; for participants with the same accuracy, the **number of API calls used to solve correct problems** serves as the secondary metric (fewer calls = higher rank)
- **Selection Mechanism:** Participants reserve a submission time slot; top 30 advance to the final
- **Focus:** Agent generalization across multi-vendor environments and stability in one-shot execution

### Phase 3 (Final)

- **Number of Problems:** 70
- **Participants:** Top 30 selected from Phase 2
- **Execution Environment:** Organizer-provided GPU resources + isolated Docker environment
- **Base Model:** Qwen3.5-35B-A3B (participants may fine-tune)
- **Time Limit:** Must be completed within 24 hours
- **Network Data:** Uses **different network data** from Phase 1 / 2
- **Focus:** Complex protocol reasoning (SRv6/EVPN) and deep fault isolation in large-scale networks (64 nodes)
- **Resource Allocation:**
  - **GPU Resources:** Huawei Cloud GPU instances for deploying the base model, independently allocated per participant
  - **Agent Tool Server:** Deployed on HuggingFace free CPU resources (free within 24h)
- **Base Model:** Qwen3.5-35B-A3B, deployed by the organizer to each participant's GPU instance
- **Submission Requirements:** Participants must upload their **fine-tuned model weights** and **Agent code** to the organizer; the organizer will deploy and execute them in the isolated environment

---

## Participant Guide

### Model Rules

1. **Base Model:** The entire competition (Phase 1 / 2 / 3) uses **Qwen3.5-35B-A3B** as the base model
2. **Fine-tuning Allowed:** Participants may fine-tune Qwen3.5-35B-A3B (LoRA, full fine-tuning, etc.)
3. **No Replacement:** Replacing it with a different architecture or parameter scale is not allowed; final inference must be based on Qwen3.5-35B-A3B
4. **Phase 3 Submission:** For Phase 3, the organizer deploys the base model on GPU instances; participants only need to submit their fine-tuned weights

### Phase-specific guidelines
For more details on Track B - Phase 1, see [`documentation/phase_1_doc.md`](documentation/phase_1_doc.md) and [`data/phase_1/test_p1.json`](data/phase_1/test_p1.json)

For more details on Track B - Phase 2, see [`documentation/phase_2_doc.md`](documentation/phase_2_doc.md) and [`data/phase_2/test_p2.json`](data/phase_2/test_p2.json)

### Local Server Deployment

If server access issues occur, participants may deploy the Agent Tool Server locally:

1. Obtain `devices_outputs.zip` from the challenge dataset. This archive is a local artifact and is intentionally not committed to Git.
2. Unzip `devices_outputs.zip` at the repository root.
3. Verify that question folders exist under `devices_outputs/` (for example `devices_outputs/1/...`). The server also supports archives that extract as `devices_outputs/devices_outputs/1/...`.
4. Run `python server.py` to deploy the local server.
5. An example agent workflow is provided in `agent/mock_agent/`.

After local deployment, change the Agent's target URL to `http://127.0.0.1:7860/api/agent/execute`; no Token required.

Before running `agent/mock_agent/evaluate_openclaw.py`, update the `OPENCLAW_DIR` and `OPENCLAW_SESSION_DIR` values in that file for your local OpenClaw installation.

To verify local readiness before running the agent, use:

```bash
python scripts/check_repo_ready.py
```

### Docker Workflow

The recommended local workflow is Docker-first, so Python dependencies stay inside the container. Keep `devices_outputs.zip` and the extracted `devices_outputs/` folder outside Git; the container reads `devices_outputs/` through a read-only bind mount.

The Compose service sets `TELCO_PRELOAD_COMMANDS=0`, so command output files are loaded lazily from the mounted folder. This avoids slow container startup on Docker Desktop when `devices_outputs/` contains many small files.

```bash
# Build the local server image
docker compose build

# Run repository readiness checks inside the container
docker compose run --rm server python scripts/check_repo_ready.py

# Start the Agent Tool Server on http://127.0.0.1:7860
docker compose up server
```

In another terminal, run the API smoke test:

```bash
docker compose exec server python scripts/smoke_server.py
```

The smoke test calls `POST http://127.0.0.1:7860/api/agent/execute` and verifies both a normal successful command and a no-permission command.

---

## Evaluation Metrics & Scoring

Each phase uses different evaluation criteria, progressively increasing in rigor:

### Scoring by Phase

| Phase | Primary Metric | Secondary Metric | Description |
|-------|---------------|-----------------|-------------|
| **Phase 1** | Accuracy | — | Scored by accuracy only |
| **Phase 2** | Accuracy | API Call Count | Accuracy first; ties broken by fewer API calls on correct problems |
| **Phase 3** | Accuracy + Speed | — | Correctness and time-based scoring (see table below) |

### Phase 3: Detailed Scoring Standards

- **Pass@1 (Consistency Metric):** Rewards agents with high success rates across 4 independent trials to ensure solution robustness.
- **TTS (Time To Solve):** Measures efficiency in pinpointing and fixing faults via logical deduction.
- **Execution Guardrail:** A strict 15-minute cutoff is implemented to prevent infinite loops and resource exhaustion.

Points are awarded only if the task is completed correctly within the allotted time. We will select the fastest solution in 4 generations. The faster the resolution, the higher the score:

| Answering time            | Discount |
| ------------------------- | -------- |
| `< 5 minutes`             | 100%     |
| `5 minutes  - 10 minutes` | 80%      |
| `10 minutes - 15 minutes` | 60%      |
| `> 15 minutes`            | 0%       |

---
