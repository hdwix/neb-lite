# Enum organization guide

This project currently keeps enums in multiple places (for example `src/app/enums` for shared app-wide values and some `constants/` subfolders within features). The guidelines below explain where to add new enums and how to decide whether an enum should live in a shared location or stay feature-local.

## Principles
- **Keep enums close to their domain.** If an enum only matters to a single bounded context (e.g., ride lifecycle, payment provider status), define it inside that module next to its domain model or repository. This keeps dependencies pointed inward and avoids leaking domain details across features.
- **Share only when truly cross-cutting.** If an enum is used by multiple modules _and_ represents a ubiquitous concept (e.g., authentication roles, global platform states), place it in `src/app/enums`. Shared enums should be stable, well-documented, and versioned carefully because changes ripple across services.
- **Differentiate domain vs. infrastructure.** Domain enums should live with the domain. Infrastructure-specific enums (e.g., queue names, external provider codes) belong in the relevant `constants/` folder within the infrastructure layer so they don’t couple the domain to infrastructure details.
- **Prefer re-use over duplication.** Before creating a new enum, search for an existing one that expresses the same concept. If two modules require the same meaning but currently duplicate enums, consolidate them into a single shared enum and update imports.
- **Name for clarity and scope.** Use explicit, scoped names (e.g., `ERideStatus`, `ERidePaymentDetailStatus`, `EAuthRole`). Avoid generic names like `Status` or `Type` when the enum is feature-specific.
- **Map persistence explicitly.** When persisting enums to the database, keep the TypeORM or Prisma column definition alongside the owning entity. Use enum-backed columns where possible so schema and code stay aligned.

## Placement checklist
1. Is the enum only referenced inside one feature module? → Create it inside that module (e.g., `src/rides/domain/constants`).
2. Does the enum model an infrastructure concern? → Place it in that layer’s `constants/` folder.
3. Is the enum shared across multiple modules and part of platform vocabulary? → Put it in `src/app/enums` with documentation.
4. Will changes to the enum require database migrations? → Keep the enum next to the entity so schema changes stay discoverable.

Following these rules will keep enums discoverable, reduce accidental coupling, and make it clearer when an enum change has cross-cutting impact.
