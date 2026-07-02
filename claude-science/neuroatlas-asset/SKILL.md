---
name: neuroatlas-asset
description: >
  Turn a request about a protein, pathogen, or drug ("show the flu virus
  hemagglutinin", "how does Paxlovid treat COVID") into a NeuroAtlas-ready 3D
  molecular asset: a real structure (from the PDB, or predicted) plus a
  catalogue entry for the NAVADA MolecularAtlas. Use whenever the user wants a
  new molecular learning module, pathogen, or drug-mechanism visual for the
  NAVADA Atlas / NeuroAtlas.
---

# NeuroAtlas molecular asset builder

You produce **drop-in catalogue entries** for the NAVADA MolecularAtlas
(`neuroatlas/molecule.html`). The atlas renders structures with **3Dmol.js**,
fetching them **live by id** from the RCSB Protein Data Bank (`pdb:`) or PubChem
(`cid:`). You therefore do **not** export geometry or GLB files — you find the
right structure id and write a precise, grounded JSON entry.

## When to use
A user asks for a new body-molecule, pathogen, protein, disease mechanism, or
cure/drug to appear in the atlas. Examples:
- "Add the influenza hemagglutinin."
- "Show how a statin binds HMG-CoA reductase."
- "Make a learning module for the HIV protease and a drug that blocks it."

## Procedure
1. **Find the structure.**
   - Prefer an **experimental structure** from the RCSB PDB. Search by molecule
     name; pick a clean, well-resolved, biologically relevant entry. For a
     *cure/mechanism*, prefer a **co-crystal** of the target **with the drug
     bound** (that single structure tells the whole story).
   - If no experimental structure exists, **predict** one with the built-in
     `alphafold2` / `esmfold2` / `boltz` skills, and for drug–target binding use
     `diffdock`. Note in the summary that the structure is predicted.
   - For a small-molecule drug on its own, use its **PubChem CID** (`cid:`).
2. **Identify the working parts ("sites").** Pick 1–4 highlightable regions:
   binding domains, catalytic residues, a bound ligand. For each, give a 3Dmol
   atom-selection (see schema) that is **valid for the chosen structure** —
   verify chain ids and residue numbers against the actual PDB entry, do not
   guess.
3. **Ground every description.** Use the `literature-review` skill to write
   accurate, learner-friendly one-to-three-sentence descriptions and collect
   **DOIs** for citations. No unsourced claims.
4. **Emit the entry** in the exact schema below, then tell the user to append it
   to the `structures` array in `neuroatlas/data/molecules.json` (and that it
   will appear in the Structures list with no code changes).

## Output schema (one object in `data/molecules.json` → `structures[]`)
```json
{
  "id": "kebab-case-unique-id",
  "name": "Human-readable name",
  "category": "pathogen | protein | cure | drug",
  "source": { "type": "pdb", "id": "6VSB" },
  "color": "#hex (theme colour for the dot/badge)",
  "defaultStyle": "cartoon | stick | sphere",
  "hideWater": true,
  "summary": "2-4 sentence learner-friendly overview of what it is and why it matters.",
  "sites": [
    {
      "name": "Site name",
      "sel": { "chain": "A", "resi": "319-541" },
      "style": "stick",
      "color": "#hex",
      "function": "One-to-two sentence, sourced description of what this site does."
    }
  ],
  "citations": ["10.xxxx/doi", "10.xxxx/doi"]
}
```

### Field rules
- `source.type` is `pdb` (use `pdb:ID`) or `cid` (use `cid:ID`); `id` is the bare id.
- `sel` is passed straight to 3Dmol's atom selector. Valid keys include
  `chain`, `resi` (number, "a-b" range, or list), `resn`, `hetflag` (true = the
  bound ligand/hetero atoms), `byres`. Keep selections **real** for the chosen id.
- `style` on a site is optional (`stick` is good for ligands/residues; omit for
  domains, which inherit the cartoon highlight).
- `defaultStyle`: `cartoon` for proteins, `stick` for small molecules.
- `hideWater: true` whenever the structure carries crystallographic waters.
- `category`: `pathogen` (viral/bacterial protein), `protein` (human/other),
  `cure` (target **with drug bound** — the mechanism), `drug` (molecule alone).

## Quality bar
- Every structure id must resolve on RCSB/PubChem. Every residue/chain in a
  `sel` must exist in that entry. Every factual claim must trace to a citation.
- Be honest about predicted vs experimental structures.
- Match the tone of the existing entries in `data/molecules.json` — warm,
  concrete, no jargon without a plain-language gloss.
