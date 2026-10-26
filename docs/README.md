# Docs

Route a question to the one document that owns the answer.
Each fact has one home; other places link to it instead of copying it.
Update the owning document in the same commit as the change it describes.
Keep headings stable, because this table links to them.

| Question | Read |
| --- | --- |
| What is Elsewhere, who is it for, and what does it promise? | [product.md](product.md) |
| What is in scope, and what is deliberately not? | [product.md#out-of-scope-for-now](product.md#out-of-scope-for-now) |
| How is content sourced and reviewed? | [product.md#content](product.md#content), then [architecture.md#content-pipeline](architecture.md#content-pipeline) |
| Where does code live, and how do the parts fit? | [architecture.md#code-map](architecture.md#code-map) |
| What is the content schema? | [architecture.md#content-model](architecture.md#content-model) |
| How does the globe work, and why? | [architecture.md#globe](architecture.md#globe) |
| What is the order of the refactor? | [architecture.md#migration-plan](architecture.md#migration-plan) |
| What is happening now, and what waits on Ryan? | [status.md](status.md) |

## Ownership

- `product.md`: product behavior contract. Change only with Ryan's agreement.
- `architecture.md`: how and why the code works. Updated with code changes.
- `status.md`: current state, open decisions, next steps. Resolved items are deleted.
