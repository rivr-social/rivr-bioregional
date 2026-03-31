# Rivr Bioregional

Standalone Rivr bioregional app and deployment guide.

This repo is the sovereign basin/region-scale distribution for cross-locale coordination, map-based discovery, knowledge-network publication, and bioregional governance surfaces.

## Goal

Someone should be able to:

1. clone this repo,
2. provision the PM Core host stack,
3. deploy the bioregional app,
4. join it to the Rivr federation,
5. expose hydrological, terrestrial, and cultural bioregion layers,
6. keep it updated from upstream releases.

## Required PM Core Links

You need the host/foundation stack first.

- PM Core: `https://github.com/peermesh/pm-core`
- Docker Lab / host deployment base: `https://github.com/peermesh/docker-lab`

Recommended reading before deployment:

- PM Core repo: `https://github.com/peermesh/pm-core`
- Docker Lab repo: `https://github.com/peermesh/docker-lab`
- Current upstream PM Core main branch: `https://github.com/peermesh/pm-core/tree/main`

## What PM Core Provides

PM Core / Docker Lab is the base host layer:

- Traefik / ingress
- PostgreSQL
- Redis
- MinIO / S3-compatible object storage
- secrets management patterns
- container orchestration layout
- standard domain wiring

Rivr Bioregional sits on top of that base.

## What Is In This Repo

This repo contains the bioregional app itself, not the entire Rivr monorepo:

- Next.js app under `src/`
- database schema and migrations under `src/db/`
- federation routing and resolution code under `src/lib/federation/`
- map and sync scripts under `src/scripts/`
- a standalone `Dockerfile`
- example compose and env files
- operator docs under `docs/`

You do not need the full Rivr monorepo to build or run this repo.

## Spatial model

Bioregions may be represented through overlapping spatial layers:

- hydrological
- terrestrial
- cultural

This repo is the seed for that sovereign surface. Runtime compatibility still uses `INSTANCE_TYPE=region`, while some current data-layer concepts still use `basin`.

## Docs

- Quick start: `docs/QUICK_BIOREGIONAL.md`
- Full deploy runbook: `docs/BIOREGIONAL_DEPLOY_RUNBOOK.md`

## Notes

- The PM Core links above are required because this app assumes the surrounding storage/network/DB foundation exists.
- The long-term product goal is guided setup from Rivr itself, but this repo is the standalone install target.
