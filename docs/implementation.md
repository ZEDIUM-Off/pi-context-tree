# Plan d'implémentation

## Objectif

Construire une extension Pi qui rend le contexte agentique déterministe par chemin de codebase.

Principe:

```text
path cible + opération
→ CONTEXT.json parents
→ context[] matching
→ sources injectées/fetchées/extraites
→ bundle contextuel borné/hashé
→ injection Pi / session scoped / subagent
```

But produit:

```text
Ne pas demander à l'agent de découvrir le contexte.
Précharger le bon contexte, au bon endroit, au bon moment.
```

## Décisions validées

- Pas de `CONTEXT.md` spécial.
- Scope implicite: dérivé du dossier contenant `CONTEXT.json`.
- Schéma simple: `context[]`, chaque entrée contient `match`, `operations`, `inject`.
- `operations` requis.
- `operations: ["*"]` autorisé.
- `match[]` utilise glob avec exclusion par préfixe `!`.
- Identité implicite d'une règle d'injection:

```text
base_path(dirname(CONTEXT.json)) + match[] + operations[]
```

- `inject[]` accepte shorthand string ou objet canonique.
- Defaults cascade parent → enfant → bloc context → source injectée.
- Cache URL configurable par défaut, par bloc, ou par URL.
- Extraction fine: sections, lignes, marqueurs, segments annotés.
- Sessions scoped gérées par Context Tree.
- Subagents réels: interop avec `pi-subagents`.
- Permissions/scope guard: interop avec `pi-guardrails` si présent, fallback minimal sinon.
- Config modifiable agentiquement plus tard via commandes/outils, avec historique et validation.

## Schéma cible v1

### Exemple minimal

```json
{
  "version": 1,
  "context": [
    {
      "match": ["**/*.ts", "!**/*.test.ts"],
      "operations": ["agent_start", "read"],
      "inject": [
        "./docs/rules.md",
        "./types.ts",
        "https://docs.vendor.com/api"
      ]
    }
  ]
}
```

### Exemple complet

```json
{
  "$schema": "https://context-tree.dev/schema/v1.json",
  "version": 1,

  "defaults": {
    "cache": {
      "mode": "ttl",
      "ttl": "14d",
      "fallback": "stale"
    },
    "budget": {
      "maxTokens": 8000,
      "perSourceMaxTokens": 2500
    }
  },

  "context": [
    {
      "match": ["**/*.ts", "!**/*.test.ts", "!**/*.spec.ts"],
      "operations": ["agent_start", "read", "edit", "write"],
      "inject": [
        {
          "type": "file",
          "path": "./docs/domain-rules.md",
          "kind": "rules",
          "required": true,
          "extract": {
            "sections": ["Billing invariants"],
            "annotations": [
              {
                "target": "Billing invariants",
                "note": "Always check these before editing billing code."
              }
            ]
          }
        },
        {
          "type": "file",
          "path": "./billing.types.ts",
          "kind": "canonical-code",
          "required": true,
          "extract": {
            "markers": ["billing-domain-types", "invoice-status-rules"],
            "lines": ["20-120", "180-220"],
            "annotations": [
              {
                "target": "invoice-status-rules",
                "note": "Treat these states as canonical. Do not invent new statuses."
              }
            ]
          }
        },
        {
          "type": "url",
          "url": "https://docs.stripe.com/billing",
          "kind": "external-doc",
          "cache": {
            "ttl": "7d"
          },
          "extract": {
            "maxTokens": 2000
          }
        }
      ]
    },
    {
      "match": ["**/*.test.ts", "**/*.spec.ts"],
      "operations": ["agent_start", "read", "edit", "write"],
      "inject": [
        "./docs/testing.md",
        "./test-fixtures/README.md"
      ]
    },
    {
      "match": ["**/*.ts"],
      "operations": ["subagent_spawn"],
      "agents": [
        ".pi/context-tree/agents/billing-worker.md"
      ],
      "inject": [
        "./prompts/subagent-billing.md",
        "./docs/domain-rules.md"
      ]
    }
  ],

  "session": {
    "new": {
      "enabled": true,
      "name": "billing",
      "injectOperations": ["session_spawn"],
      "summaries": {
        "scopeAware": true,
        "onCompact": true,
        "onTreeExit": true
      }
    }
  },

  "permissions": {
    "scopeGuard": {
      "enabled": true,
      "mode": "ask",
      "nonInteractive": "block",
      "allow": ["src/shared/**"],
      "block": [".env*", "infra/prod/**"],
      "grant": ["once", "session", "always"]
    }
  },

  "subagents": {
    "runner": "pi-subagents",
    "agents": [
      ".pi/context-tree/agents/billing-worker.md",
      ".pi/context-tree/agents/billing-reviewer.md"
    ]
  }
}
```

## Opérations supportées

`operations` est requis.

Valeurs prévues:

```text
*
agent_start
read
edit
write
grep
find
ls
bash
session_spawn
subagent_spawn
```

Sémantique:

- `*`: applicable à toute opération.
- `agent_start`: injection avant premier appel modèle du tour.
- `read`: injection liée à lecture fichier.
- `edit` / `write`: contexte requis avant modification; si absent, bloquer/preflight puis injecter.
- `grep` / `find` / `ls`: contexte possible sur scope de recherche.
- `bash`: parsing best-effort des chemins; si ambigu en session scoped, demander confirmation.
- `session_spawn`: contexte ajouté à nouvelle session scoped.
- `subagent_spawn`: fragments ajoutés au prompt de subagent.

## Résolution des scopes

Pour un path cible:

```text
src/features/billing/invoice.service.ts
```

Collecter:

```text
/CONTEXT.json
/src/CONTEXT.json
/src/features/CONTEXT.json
/src/features/billing/CONTEXT.json
```

Chaque `CONTEXT.json` définit son scope implicitement:

```text
dirname(CONTEXT.json)
```

`match[]` est évalué relativement à ce scope.

Exemple:

```text
CONTEXT: src/features/billing/CONTEXT.json
Target:  src/features/billing/invoice.service.ts
Rel:     invoice.service.ts
```

## Résolution `context[]`

Pour chaque fichier `CONTEXT.json`, dans ordre parent → enfant:

1. Charger et valider JSON.
2. Merger `defaults` hérités.
3. Parcourir `context[]` dans ordre fichier.
4. Vérifier opération:
   - match si `operations` contient opération courante ou `*`.
5. Vérifier `match[]`:
   - glob positif requis.
   - glob `!` = exclusion.
   - match si au moins un positif match et aucun négatif match.
6. Normaliser `inject[]`.
7. Appliquer cascade defaults.
8. Dédupliquer sources.
9. Charger/fetcher/extracter.
10. Construire bundle.

## Identité implicite

Chaque bloc contextuel a une identité stable calculée:

```text
contextId = hash({
  basePath: dirname(CONTEXT.json),
  match,
  operations
})
```

Usage:

- déduplication once-per-turn;
- audit;
- cache bundle;
- explication `/context-tree explain`;
- historique des injections.

Un `id` explicite pourra être ajouté plus tard, mais ne doit pas être requis.

## Normalisation `inject[]`

### Shorthand string

```json
"inject": [
  "./docs/domain-rules.md",
  "https://docs.stripe.com/billing"
]
```

Devient:

```json
{
  "type": "file",
  "path": "./docs/domain-rules.md"
}
```

ou:

```json
{
  "type": "url",
  "url": "https://docs.stripe.com/billing"
}
```

### Objet canonique

```json
{
  "type": "file",
  "path": "./docs/domain-rules.md",
  "kind": "rules",
  "required": true
}
```

Types initiaux:

```text
file
url
```

Types futurs:

```text
symbol
command
subagent_prompt
```

## Extraction fine

Objectif: ne pas injecter tout un fichier si une partie suffit.

### Sections markdown

```json
{
  "type": "file",
  "path": "./docs/domain-rules.md",
  "extract": {
    "sections": ["Billing invariants", "Stripe webhook rules"]
  }
}
```

### Lignes multiples

```json
{
  "type": "file",
  "path": "./billing.types.ts",
  "extract": {
    "lines": ["20-120", "180-220"]
  }
}
```

### Marqueurs annotés

Code:

```ts
// context-tree:start billing-domain-types
export type InvoiceStatus = "draft" | "open" | "paid" | "void";
// context-tree:end billing-domain-types
```

Markdown:

```md
<!-- context-tree:start billing-invariants -->
...
<!-- context-tree:end billing-invariants -->
```

Config:

```json
{
  "type": "file",
  "path": "./billing.types.ts",
  "extract": {
    "markers": ["billing-domain-types"]
  }
}
```

### Annotations agent spécifiques

Besoin: sélectionner plusieurs parties + ajouter instruction locale au segment.

```json
{
  "type": "file",
  "path": "./billing.types.ts",
  "extract": {
    "segments": [
      {
        "marker": "billing-domain-types",
        "note": "Canonical domain types. Do not duplicate or redefine."
      },
      {
        "lines": "180-220",
        "note": "Legacy compatibility branch. Preserve behavior unless task explicitly says migration."
      },
      {
        "section": "Billing invariants",
        "note": "Use this as checklist before edit/write."
      }
    ]
  }
}
```

Rendu bundle:

```md
## Source: billing.types.ts#billing-domain-types
Agent note: Canonical domain types. Do not duplicate or redefine.

```ts
...
```
```

## URL cache

Cache local:

```text
.pi/context-tree/cache/urls/
  <sha256-url>.json
  <sha256-url>.md
```

Metadata:

```json
{
  "url": "https://docs.stripe.com/billing",
  "fetchedAt": "2026-04-25T12:00:00.000Z",
  "status": 200,
  "etag": "...",
  "contentHash": "sha256:...",
  "ttl": "14d",
  "trust": "official"
}
```

Cache settings cascade:

```text
defaults.cache
→ context block cache
→ inject item cache
```

Modes:

```text
ttl
manual
pinned
latest
```

MVP:

```text
ttl + stale fallback
```

## Bundle contextuel

Bundle contient:

```json
{
  "operation": "agent_start",
  "targetPath": "src/features/billing/invoice.service.ts",
  "bundleHash": "sha256:...",
  "contexts": [
    {
      "contextId": "sha256:...",
      "basePath": "src/features/billing",
      "match": ["**/*.ts", "!**/*.test.ts"],
      "operations": ["agent_start", "read"],
      "sources": []
    }
  ]
}
```

Injection texte:

```md
# Context Tree Bundle

Target: `src/features/billing/invoice.service.ts`
Operation: `agent_start`
Bundle: `sha256:...`

## Loaded sources
- `src/features/billing/docs/domain-rules.md`
- `src/features/billing/billing.types.ts#billing-domain-types`
- `https://docs.stripe.com/billing` cache hit, 5d old

...
```

## Pi hooks

### `before_agent_start`

Responsabilités:

- parser `@file` dans prompt Pi;
- parser chemins textuels simples;
- résoudre bundles `agent_start`;
- injecter avant premier appel modèle;
- dédupliquer once-per-turn.

### `tool_call`

Responsabilités:

- `read`, `edit`, `write`, `grep`, `find`, `ls`, `bash`;
- résoudre opération cible;
- vérifier contexte requis déjà injecté;
- pour `edit/write`, bloquer si contexte manquant puis injecter;
- scope guard hors scope;
- demander confirmation hors scope selon permissions.

### `tool_result`

Responsabilités:

- enrichir résultats `read` avec bundle si nécessaire;
- capturer fichiers lus pour summaries.

### `context`

Responsabilités:

- garantir déduplication;
- maintenir injection once-per-turn;
- éviter pollution contextuelle.

### `session_before_compact` / `session_before_tree`

Responsabilités:

- summaries scope-aware;
- fichiers lus/modifiés;
- sources contextuelles utilisées;
- risques ouverts.

## Sessions scoped

Commande:

```text
/context-tree new <path> [prompt]
```

Comportement:

1. attendre idle;
2. résoudre bundle `session_spawn` pour path;
3. créer nouvelle session Pi;
4. nommer session selon config;
5. injecter custom message Context Tree;
6. append custom entry metadata;
7. envoyer prompt optionnel.

Metadata session:

```json
{
  "customType": "context-tree",
  "data": {
    "scopePath": "src/features/billing",
    "targetPath": "src/features/billing/invoice.service.ts",
    "bundleHash": "sha256:...",
    "operation": "session_spawn"
  }
}
```

## Subagents

Interop cible: `pi-subagents`.

Config:

```json
{
  "subagents": {
    "runner": "pi-subagents",
    "agents": [
      ".pi/context-tree/agents/billing-worker.md"
    ]
  }
}
```

Context block:

```json
{
  "match": ["**/*.ts"],
  "operations": ["subagent_spawn"],
  "agents": [".pi/context-tree/agents/billing-worker.md"],
  "inject": [
    "./prompts/subagent-billing.md",
    "./docs/domain-rules.md"
  ]
}
```

Commande:

```text
/context-tree subagent <path> <task>
```

Comportement:

```text
path + subagent_spawn
→ resolve bundle
→ choose agent md
→ compose prompt
→ delegate to pi-subagents
```

MVP peut détecter absence de `pi-subagents` et afficher instruction d'installation.

## Permissions / scope guard

Config:

```json
{
  "permissions": {
    "scopeGuard": {
      "enabled": true,
      "mode": "ask",
      "nonInteractive": "block",
      "allow": ["src/shared/**"],
      "block": [".env*", "infra/prod/**"],
      "grant": ["once", "session", "always"]
    }
  }
}
```

Default:

```text
hors scope → confirmation utilisateur
```

Options confirmation:

```text
Allow once
Allow for session
Always allow this path
Always allow this directory
Deny
```

Interop:

- si `pi-guardrails` présent: utiliser/générer policy compatible quand possible;
- sinon fallback `tool_call` minimal dans context-tree.

## Commandes prévues

MVP:

```text
/context-tree explain <path> [operation]
/context-tree validate
/context-tree fetch [path]
/context-tree cache list
/context-tree cache refresh <path>
/context-tree new <path> [prompt]
```

Phase suivante:

```text
/context-tree subagent <path> <task>
/context-tree guard status
/context-tree guard grants
/context-tree guard revoke <path>
/context-tree normalize
/context-tree history
/context-tree rollback <id>
```

Outils agentiques futurs:

```text
context_tree_explain
context_tree_validate
context_tree_fetch
context_tree_compile
context_tree_new_session
context_tree_spawn_subagent
context_tree_update_config
```

Toute modification config via outil/commande devra:

- valider schema;
- formater stablement;
- enregistrer historique;
- produire diff lisible;
- demander confirmation si modification importante.

## Tests unitaires et déterminisme

Le moteur de contexte doit être testable sans Pi. Toute logique pure doit vivre hors extension Pi.

Structure suggérée:

```text
src/core/
  schema.ts
  scan.ts
  match.ts
  normalize.ts
  resolve.ts
  extract.ts
  bundle.ts
  cache.ts

src/pi/
  extension.ts
  commands.ts
  hooks.ts
  sessions.ts

test/unit/
  schema.test.ts
  scan.test.ts
  match.test.ts
  normalize.test.ts
  resolve.test.ts
  extract.test.ts
  bundle.test.ts
  cache.test.ts
  permissions.test.ts
  prompt-paths.test.ts

test/fixtures/
  repo-basic/
  repo-parent-child/
  repo-extraction/
  repo-url-cache/
```

### Tests schéma

Couvrir:

- `version` requis.
- `context[]` requis ou vide autorisé selon décision finale.
- `match[]` requis et non vide.
- `operations` requis.
- `operations: ["*"]` valide.
- opérations inconnues rejetées.
- `inject[]` requis et non vide.
- shorthand string valide.
- objet `file` valide.
- objet `url` valide.
- `scope` manuel rejeté.
- `required`, `cache`, `budget`, `extract` validés.

### Tests matching

Cas à couvrir:

```text
match ["**/*.ts"] matches foo.ts, nested/foo.ts
match ["**/*.ts", "!**/*.test.ts"] exclut foo.test.ts
match ["**/*.test.ts", "**/*.spec.ts"] inclut les deux familles
match relatif au dossier du CONTEXT.json
match parent root voit path complet relatif repo
match enfant voit path relatif scope enfant
match sans glob positif rejeté
```

Tests opération:

```text
operations ["agent_start"] match agent_start seulement
operations ["*"] match toutes opérations
operations ["read", "edit"] match read/edit pas write
```

### Tests identité implicite

Vérifier stabilité:

```text
contextId = hash(basePath + match[] + operations[])
```

Cas:

- même basePath/match/operations → même id;
- basePath différent → id différent;
- match différent → id différent;
- operations différent → id différent;
- ordre `match[]` conservé comme significatif ou normalisé selon décision finale;
- ordre `operations[]` normalisé recommandé pour éviter ids instables.

Décision recommandée:

```text
match[] ordre significatif pour lecture humaine, mais id utilise match[] tel quel.
operations[] triées pour id stable.
```

### Tests normalisation `inject[]`

Couvrir:

- `./docs/rules.md` → `{ type: "file", path: "./docs/rules.md" }`.
- `https://x.y/doc` → `{ type: "url", url: "https://x.y/doc" }`.
- paths résolus relativement au `CONTEXT.json` contenant la source.
- URLs gardées absolues.
- defaults appliqués parent → enfant → bloc → source.
- source-level cache override block cache.
- block cache override defaults cache.
- dedupe par path/url normalisé.

### Tests lecture de contextes locaux

Fixtures avec plusieurs `CONTEXT.json`:

```text
repo-parent-child/
  CONTEXT.json
  src/CONTEXT.json
  src/features/billing/CONTEXT.json
  src/features/billing/docs/rules.md
  src/features/billing/invoice.ts
```

Assertions:

- scan parents retourne fichiers dans ordre root → leaf;
- scope implicite correct;
- context root + parent + child mergés;
- source locale chargée avec contenu exact;
- source `required: true` manquante produit erreur ou warning selon politique;
- source optional manquante n'arrête pas résolution;
- path escape `../outside.md` rejeté par défaut.

### Tests extraction

Markdown sections:

- extrait section exacte;
- stoppe à prochain heading même niveau ou supérieur;
- supporte sections multiples;
- missing section required → erreur;
- missing section optional → warning.

Lignes:

- extrait `20-120` inclusif;
- extrait segments multiples dans ordre donné;
- rejette plages invalides;
- gère EOF proprement.

Markers:

- extrait `context-tree:start name` / `context-tree:end name`.
- supporte commentaires TS `//`.
- supporte commentaires MD `<!-- -->`.
- supporte plusieurs markers dans même fichier.
- missing marker required → erreur.
- nested markers rejetés ou définis explicitement.

Segments annotés:

```json
{
  "segments": [
    { "marker": "billing-domain-types", "note": "Canonical types." },
    { "lines": "10-20", "note": "Legacy path." },
    { "section": "Invariants", "note": "Checklist before edit." }
  ]
}
```

Assertions:

- chaque segment garde son `note`;
- rendu bundle inclut note près du contenu;
- segments multiples gardent ordre config;
- même fichier + segments distincts ne se dédupliquent pas à tort.

### Tests bundle

Couvrir:

- bundle contient targetPath, operation, bundleHash;
- bundleHash stable pour mêmes sources/contenus;
- changement contenu source change bundleHash;
- dedupe sources identiques;
- token budget retire sources optionnelles basse priorité avant required;
- required jamais supprimé sans erreur explicite;
- rendu markdown stable snapshot-testable;
- sources listées avec path/url/cache metadata.

### Tests URL cache

À tester avec fetch mocké, jamais réseau réel.

Cas:

- cache miss → fetch → écrit `.json` + `.md`;
- cache hit fresh → pas de fetch;
- cache stale + fallback stale + fetch fail → utilise stale avec warning;
- cache stale + fetch success → refresh;
- source-level ttl override defaults ttl;
- contentHash stable;
- URL key = sha256 URL canonique;
- invalid HTTP/non-HTTPS rejeté selon politique.

### Tests permissions/scope guard

Logique pure séparée:

- path dans scope autorisé;
- path hors scope en mode ask → décision `ask`;
- mode block → block;
- mode allow → allow;
- `allow[]` autorise hors scope;
- `block[]` gagne sur allow;
- grants once/session/always appliqués;
- nonInteractive ask → block.

### Tests parsing prompt `@file`

Couvrir:

- extrait `@src/foo.ts`;
- extrait plusieurs refs;
- ignore email/URL si nécessaire;
- supporte paths avec tirets/underscores/dots;
- fallback path texte simple `src/foo.ts`;
- dédup paths.

### Tests hooks Pi

À garder majoritairement en tests unitaires avec faux events/context.

- `before_agent_start` injecte bundle pour `@file`.
- n'injecte pas deux fois même contextId dans même tour.
- `tool_call edit` bloque si contexte edit requis manquant.
- `tool_call edit` laisse passer si bundle déjà injecté.
- `tool_result read` enrichit résultat si contexte read applicable.
- session scoped crée custom entry + custom message attendus.

## Phases d'implémentation

### Phase 1 — Schéma + résolution locale

- Définir types TypeScript.
- Valider `CONTEXT.json`.
- Scanner parents d'un path.
- Résoudre scope implicite.
- Implémenter `match[]` avec `!`.
- Exiger `operations`.
- Supporter `operations: ["*"]`.
- Normaliser `inject[]` shorthand.
- Charger fichiers locaux.
- Tests unitaires:
  - schema;
  - scan parents;
  - scope implicite;
  - matching;
  - operations;
  - normalisation inject;
  - lecture fichiers locaux.
- Commandes:
  - `/context-tree validate`
  - `/context-tree explain <path> [operation]`

### Phase 2 — Extraction + bundle

- Sections markdown.
- Lignes multiples.
- Marqueurs `context-tree:start/end`.
- Segments annotés avec `note`.
- Budget token simple.
- Dedupe sources.
- Bundle hash.
- Tests unitaires:
  - extraction sections;
  - extraction lignes;
  - extraction markers;
  - segments annotés;
  - bundle hash stable;
  - rendu markdown snapshot.

### Phase 3 — URL cache

- Fetch URLs.
- Cache `.pi/context-tree/cache/urls`.
- TTL + stale fallback.
- Metadata hash.
- Tests unitaires avec fetch mocké:
  - miss;
  - hit fresh;
  - stale refresh;
  - stale fallback;
  - ttl override;
  - contentHash.
- Commandes cache/fetch.

### Phase 4 — Injection Pi

- `before_agent_start` avec `@file`.
- Path detection simple dans prompt.
- `tool_result` pour read.
- `tool_call` preflight edit/write si contexte manquant.
- Dedupe once-per-turn.
- Tests unitaires hooks avec faux Pi context:
  - injection `@file`;
  - dédup tour;
  - preflight edit/write;
  - read enrichment.

### Phase 5 — Sessions scoped

- `/context-tree new <path> [prompt]`.
- Custom message + custom entry.
- Session name.
- Summaries scope-aware pour compact/tree.
- Tests unitaires:
  - composition bundle `session_spawn`;
  - metadata custom entry;
  - rendu custom message;
  - summary prompt scope-aware.

### Phase 6 — Permissions

- Scope guard configurable.
- Confirmation hors scope.
- Grants once/session/always.
- Fallback non-interactive block.
- Interop `pi-guardrails` si possible.
- Tests unitaires:
  - décisions allow/ask/block;
  - allow/block patterns;
  - grants;
  - non-interactive fallback.

### Phase 7 — Subagents

- Détection `pi-subagents`.
- Référence agents `.md` compatibles.
- Compilation `subagent_spawn`.
- Composition prompt.
- Tests unitaires:
  - résolution agents par context block;
  - composition prompt avec bundle;
  - erreur lisible si runner absent.
- Commande `/context-tree subagent`.

### Phase 8 — Maintenance agentique config

- Commandes add/remove/normalize/history.
- Outils agentiques.
- Historisation.
- Rollback.
- Tests unitaires:
  - patch JSON stable;
  - validation avant écriture;
  - history entry;
  - rollback.

## Critères de succès MVP

- Un `CONTEXT.json` minimal suffit à injecter bons fichiers.
- `/context-tree explain` explique exactement pourquoi source chargée.
- Injection fonctionne avec prompt contenant `@file`.
- URLs ne refetchent pas à chaque tour.
- Bundle hashé et dédupliqué.
- Échec source required visible.
- Aucun `scope` manuel requis dans JSON.

## Non-objectifs MVP

- AST symbol extraction complète.
- Subagents background complexes.
- Génération automatique parfaite de config.
- Enforcement permissions complet équivalent guardrails.
- UI complexe TUI.
