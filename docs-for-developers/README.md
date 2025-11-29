# Documentation index

The `docs-for-developers/` directory collects references for engineers building and operating neblite.

- **Developer onboarding and conventions** (`developer-onboarding.md`): Start here for local setup, coding standards, testing expectations, and git workflow guidance.
- **Enum organization guide** (`enum-organization.md`): Rules for deciding where enums live and how to avoid cross-module coupling.
- **Ride creation-to-acceptance flow** (main `README.md`, Key LLD Flows #7): Sequence diagram for the ride lifecycle and guidance on current single-driver selection behavior.
- **Load testing scripts** (`k6-loadtest-script/*.js`): k6 scenarios for driver location throughput and trip location updates.
- **API collection** (`postman-collection/nebengjek.postman_collection.json`): Postman collection covering public Gateway endpoints.

Keep these documents up to date when workflows, conventions, load test scripts, or public contracts change.
