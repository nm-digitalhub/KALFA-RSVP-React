pg-boss          

[pg-boss](/ "pg-boss")

Search

*   [](https://github.com/timgit/pg-boss)
*   [](https://www.npmjs.com/package/pg-boss)

# pg-boss

Queueing jobs in Postgres from Node.js like a boss

[Get Started](/introduction)

[API Reference](/api/constructor)

*   [
    
    ## Production-grade policies
    
    Rate limiting, debouncing, concurrency, priorities, dead-letter queues and retries with exponential backoff.
    
    Queue policies
    
    
    
    
    
    ](/api/queues)
*   [
    
    ## Transactional & ORM-ready
    
    Send or complete jobs inside your existing transaction with adapters for Drizzle, Knex, Kysely and Prisma, or let transactional workers commit a handler's writes with its job.
    
    Adapters
    
    
    
    
    
    ](/api/adapters)
*   [
    
    ## Low-latency workers
    
    Backpressure-aware polling workers with optional LISTEN/NOTIFY for rapid delivery.
    
    Workers
    
    
    
    
    
    ](/api/workers)
*   [
    
    ## Workflows & scheduling
    
    Job dependency orchestration, cron scheduling and job deferral for multi-step pipelines.
    
    Jobs & flows
    
    
    
    
    
    ](/api/jobs)
*   [
    
    ## Web dashboard & HTTP proxy
    
    A web dashboard to monitor and manage queues and jobs, and an HTTP proxy for calling pg-boss from any language or runtime.
    
    Dashboard
    
    
    
    
    
    ](/dashboard)
*   [
    
    ## Runs anywhere Postgres does
    
    Serverless and multi-master friendly, with CockroachDB, Citus and embedded PGlite support.
    
    Database backends
    
    
    
    
    
    ](/database-backends)

js

```
async function readme() {
  const { PgBoss } = require('pg-boss');
  const boss = new PgBoss('postgres://user:pass@host/database');

  boss.on('error', console.error)

  await boss.start()

  const queue = 'readme-queue'

  await boss.createQueue(queue)

  const id = await boss.send(queue, { arg1: 'read me' })

  console.log(`created job ${id} in queue ${queue}`)

  await boss.work(queue, async ([ job ]) => {
    console.log(`received job ${job.id} with data ${JSON.stringify(job.data)}`)
  })
}

readme()
  .catch(err => {
    console.log(err)
    process.exit(1)
  })
```

pg-boss is a job queue built in Node.js on top of PostgreSQL in order to provide background processing and reliable asynchronous execution to Node.js applications.

pg-boss relies on Postgres's SKIP LOCKED, a feature built specifically for message queues to resolve record locking challenges inherent with relational databases. Concurrent workers claim jobs without blocking each other, and job processing gets the safety of guaranteed atomic commits.

This will likely cater the most to teams already familiar with the simplicity of relational database semantics and operations (SQL, querying, and backups). It will be especially useful to those already relying on PostgreSQL that want to limit how many systems are required to monitor and support in their architecture.

## Summary [​](#summary)

*   Create jobs in an existing db transaction, including adapters for popular ORMs such as Drizzle, Knex, Kysely, Prisma
*   Backpressure-compatible polling workers, including support for LISTEN/NOTIFY low latency delivery
*   Job dependency workflow orchestration
*   Cron and RRULE scheduling, job deferral
*   Queue storage policies to support a variety of rate limiting, debouncing, and concurrency use cases
*   Priority queues, dead letter queues with redrive, automatic retries with exponential backoff
*   Pub/sub API for fan-out queue relationships
*   SQL support for non-Node.js runtimes for most operations
*   Serverless function compatible
*   [OpenTelemetry](/opentelemetry) traces and metrics
*   Multi-master compatible (for example, in a Kubernetes ReplicaSet)
*   [Additional database backends](/database-backends) for Postgres-based databases such as CockroachDB and Citus. Or, use embedded PGlite for running entirely in-process.

## CLI [​](#cli)

pg-boss includes a command-line interface if needed for managing database migrations without writing code. This is useful for CI/CD pipelines, database setup scripts, or manual schema management.

See the [CLI documentation](/cli) for details.

## Dashboard [​](#dashboard)

A web-based dashboard is available in the [`@pg-boss/dashboard`](https://www.npmjs.com/package/@pg-boss/dashboard) package for monitoring and managing jobs, queues and schedules.

See the [dashboard documentation](/dashboard) for details.

## Proxy [​](#proxy)

A HTTP proxy is available in the [`@pg-boss/proxy`](https://www.npmjs.com/package/@pg-boss/proxy) package if needed to support use cases such as platform compatibility and connection pooling or scalability.

See the [proxy documentation](/proxy) for details.

## Requirements [​](#requirements)

*   Node 22.12 or higher, or Bun
*   PostgreSQL 13 or higher

## Sponsors [​](#sponsors)

pg-boss is MIT licensed and always will be. It is maintained by one person, and sponsorship is what pays for the maintenance, security response, and support behind it.

[Become a sponsor](https://github.com/sponsors/timgit), or see everyone who already does on the [sponsors page](/sponsors).

[![Superpower](https://avatars.githubusercontent.com/u/114334709?s=256&v=4 "Superpower")](https://superpower.com/)[![Altruistiq](https://avatars.githubusercontent.com/u/88195975?s=256&v=4 "Altruistiq")](https://altruistiq.com/)[![wasp-lang](https://avatars.githubusercontent.com/u/55102317?s=256&v=4 "wasp-lang")](https://wasp.sh/)[![Ferry Health](https://avatars.githubusercontent.com/u/158637456?s=256&v=4 "Ferry Health")](https://github.com/Ferry-Health)

## Contributing [​](#contributing)

To setup a development environment for this library:

bash

```
git clone https://github.com/timgit/pg-boss.git
npm install
```

To run the test suite, linter and code coverage:

bash

```
npm run cover
```

The test suite will try and create a new database named pgboss. The [config.json](https://github.com/timgit/pg-boss/blob/master/test/config.json) file has the default credentials to connect to postgres.

The [Docker Compose](https://github.com/timgit/pg-boss/blob/master/docker-compose.yaml) file can be used to start a local postgres instance for testing:

bash

```
docker compose up
```