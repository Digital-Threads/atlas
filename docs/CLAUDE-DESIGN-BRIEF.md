# Atlas viewer expansion: Claude Design brief

Design additional Atlas viewer screens. Atlas is a local architecture intelligence
application, not a marketing website. Preserve the current Atlas visual system and
interaction language exactly: compact top bar, left navigation, large unframed map
canvas, right details panel, restrained colors, sharp typography, small radii,
semantic node colors, animated directional relationships, and progressive disclosure.
The existing prototype is `docs/design/atlas-viewer-prototype.html`.

## Product outcome

A developer, product manager, QA engineer, or new team member must understand a large
backend without reading every source file. Every screen must answer a concrete
question, show direction clearly, and avoid an undifferentiated force-directed graph.

## Required screens

1. **Data architecture overview**
   - Database -> schema -> table hierarchy.
   - Designed for 176+ tables without hiding the catalog.
   - Search and filters for schema, database, and relationship type.
   - Show relationship-rich tables first on canvas while retaining every table in a searchable catalog.

2. **Focused table ERD**
   - Five deterministic columns: migrations, selected table, columns, indexes and constraints, relations and access.
   - Every column shows type, nullable/required, PK, unique, default, and mapped database name when available.
   - Incoming and outgoing foreign keys have clear direction and key columns.
   - Code that reads the table is visually separate from code that writes it.

3. **Migration history**
   - Chronological timeline and optional table-centric view.
   - Each migration shows created, altered, and dropped structures.
   - Destructive changes and rollback uncertainty are visually obvious.
   - Filters by table, operation, order/date, and source file.

4. **ClickHouse architecture**
   - Databases, tables, materialized views, and source/target flows.
   - Table profile shows engine, partition expression, ORDER BY, primary key, TTL, columns, and view dependencies.
   - Analytical data movement reads left to right.

5. **Asynchronous messaging**
   - Overview: brokers -> topics/queues -> consumers/processors.
   - Focused flow: publisher -> broker/channel -> handler/processor -> services -> data/external effects.
   - Support Kafka, RabbitMQ, Bull, and BullMQ terminology without mixing semantics.
   - Edge animation communicates direction; hover emphasizes the active chain.

6. **Scheduled jobs**
   - Catalog of cron, interval, timeout, repeatable queue jobs, and Kubernetes CronJobs.
   - Human schedule, raw expression, timezone, owner, environment, concurrency policy, and suspend state.
   - Focused scene: schedule -> handler -> work -> data/events -> external effects.
   - Explicit empty state when no jobs are detected.

7. **Operations**
   - Keep Deployment, Runtime, Environments, and Configuration as separate navigation items.
   - Deployment columns: workflow -> CI/CD jobs -> build stages -> image artifact -> deployment target.
   - Runtime columns: public entry -> routing -> workloads -> containers -> configuration.
   - Deployment and Runtime use the same segmented environment control: Development, Staging, Production.
   - Environments is a comparison view: one row per detected environment with separate delivery, runtime, and configuration summaries.
   - Show workflows/jobs, Docker stages/images, Compose services, Kubernetes workloads/containers, replicas, resources, probes, services, ingress, ConfigMaps, and Secret names.
   - Never show environment or Secret values. Use “names only, values never stored” where needed.
   - If an environment has no configuration, show that clearly while retaining shared CI/build stages where relevant.

8. **Configuration contract**
   - Environment variable names grouped by environment and owning component.
   - Required/optional, documented purpose, and safe `.env.example` sample values only.
   - Secret-like variables show a hidden-value state, never a fake value.
   - Show where each variable is consumed and which runtime object provides it.

## Shared interaction rules

- Desktop reference viewport: 1440 x 900. Also provide usable 1280 x 720 and mobile layouts.
- Canvas pan is immediate and never selects text/cards. Wheel zoom reaches a useful scale in a few gestures and zooms around the pointer.
- Click selects. Hover previews the connected chain. Escape clears selection. Back/forward preserves scene history.
- Fit, zoom in, zoom out, and reset use familiar icons with tooltips.
- Long labels wrap or truncate with a tooltip. Text never overflows badges, cards, tabs, or details.
- The right panel uses consistent sections: plain-language purpose, technical facts, incoming, outgoing, flow narrative, risks, and source evidence.
- Motion explains direction and state changes, not decoration. Respect reduced-motion preferences.
- Provide loading, empty, partial-detection, selected, hovered, filtered, no-results, and large-dataset states.
- Do not use force-directed layouts for primary scenes, nested cards, marketing heroes, decorative gradients, or oversized headings.

## Data contract assumptions

The viewer receives nodes with `id`, `type`, `label`, `file`, `desc`, `details`, and
edges with `from`, `to`, `verb`, and `kind`. Types include table, column, index,
constraint, migration, materialized_view, scheduled_job, workflow, pipeline_job,
build_stage, container_image, container, deployment, infrastructure_service, ingress,
config_map, secret, environment, broker, topic, queue, processor, method, service, and
external. Designs must work with missing optional details and thousands of nodes.

## Deliverables

- One standalone offline HTML prototype containing every screen and interaction.
- Editable source files, not screenshots only.
- Component/state inventory and a compact token sheet for color, spacing, typography, borders, shadows, and motion.
- Mapping table from each screen element to the data contract above.
- Realistic but generic demo data; no product-specific names in reusable components.
- Preserve current Atlas components 1:1 where they exist and extend only where these screens require new behavior.
