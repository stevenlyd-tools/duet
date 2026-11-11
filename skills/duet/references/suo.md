# Duet with Suo

[Suo](https://github.com/stevenlyd-tools/suo) records what a product is meant to do as versioned Units: an objective, scope and acceptance criteria, a choice state, and honest implementation coverage. Duet moves code from prototype to `main`. They are separate tools that fit together: Suo answers "what did we decide to build", Duet answers "where is the code for it".

Suo is recommended, not required. Use it when the project declares it. Do not initialize Suo in a project just to use Duet.

## Stages and states

| Duet stage | Who | Suo Unit |
| --- | --- | --- |
| Idea, not yet built | prototyper | choice `proposed` |
| Experiment checkpointed or in Alpha | prototyper | choice `experimental` |
| Selected and handed off | prototyper decides | choice `approved`; implementation not yet claimed |
| Experiment discarded or parked | prototyper decides | choice `deferred`, or the Unit is removed through Suo's normal review |
| Hardened and merged to `main` | engineer | implementation coverage recorded as `implemented` for the criteria actually covered |

A choice state is a product decision. Implementation coverage is an engineering statement. Keep them apart: a prototype in Alpha does not make a Unit `approved`, and `approved` does not mean anything was built. Record only what is true for the snapshot you are on. Definitions and code may be promoted to `main` independently.

Change Units only through the installed Suo Skill and its matching CLI. Do not edit generated views by hand.

## What a handoff carries

With Suo, a handoff names the Unit IDs it covers. The Units supply the objective, scope and acceptance criteria, so the checkpoint description only needs to say what was built and what is known to be rough.

Without Suo, the same information goes into the checkpoint itself:

```
duet experiment checkpoint ID --select \
  --description "What this prototype does and what is known to be rough" \
  --acceptance "A statement someone can check" \
  --acceptance "Another one"
```

Either way the engineer must be able to answer three questions from the handoff alone: which exact commit, what it is meant to do, and how to tell that it works. A handoff that cannot answer them is not ready; ask for the missing part.

## During hardening

- Harden against the Unit's acceptance criteria. If the prototype and the Unit disagree, the Unit is the definition; raise the difference with the prototyper instead of choosing silently.
- If hardening changes user-visible behavior, update the Unit through Suo before or together with the code change, with the prototyper's decision recorded.
- After the merge, record coverage only for the selected Units. Leave sibling Units that were not part of this handoff unchanged; a parent is not complete because some children shipped.
- `duet completion --suo-cli PATH --sha FULL_SHA --ids ID,ID` checks that the selected Units at that commit declare current coverage and link their engineering record. It reads only; it does not run CI or verify a deployment. Pass an installed Suo runtime, normally the project's `node_modules/@stevenlyd/suo/dist/cli.js`. See [delivery](delivery.md).

## What stays out of Suo

Issue state, assignees, CI results and deployment status are live observations. They belong in GitHub Issues, pull requests and delivery reports, not in Units.
