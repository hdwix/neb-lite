# Project Nebengjek

Nebengjek is an application to unite rider/consumer and driver for ride haling service, with following logic

Nebengjek Logic

1. user/rider activate order ⇒ being informed of all drivers within range
2. driver ⇒ always send location data
3. user select specific driver
4. driver being informed if he/she is selected ⇒ driver will be informed about: user/rider location, destination, possibility whether easy or difficult
5. driver will submit whether he/she accept/agree to take the user
6. if driver agree driver will pick the user
7. user and driver go to destination
8. along the way to destination, both will be informed of rate (3000 / km )
9. Upon arrive in destination, trx complete and driver will charge the user and apply discount
10. Nebengjek apps will take 5% fee of trx in no. 9

Assumption :

driver can switch on/off of location activation

## Environment Variables

| Variable                      | Description                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `SMS_SERVICE_URL`             | Base URL for the SMS provider endpoint that delivers OTP messages.                                                    |
| `OTP_SIMULATION_ACCESS_TOKEN` | Static token that authorizes access to the OTP simulation SSE stream. Leave unset to disable the simulation endpoint. |

## Architecture Design Document

1. High-Level Design (HLD)

1.1 Overview

This architecture simplifies the system by using a Monolithic API that connects to:
• Redis for two purposes:
• Geospatial indexing (Redis GEO)
• Event bus (Redis Streams)
• PostgreSQL / MySQL for persistent relational storage
• Background Workers that process Redis Streams asynchronously
• SSE (Server-Sent Events) for notifying clients in real-time

The architecture prioritizes simplicity, fast development, and moderate scalability.

1.2 HLD Diagram (Mermaid)

<!-- prettier-ignore -->
:::mermaid
graph TD
  A[Client Mobile/Web] --> B[Monolith API Service]
  B --> C[Redis]
  B --> D[PostgreSQL - MySQL]
  C --> E[Background Workers]
  C -->|GEO| B
  C -->|Stream| E
  E -->|Stream| C
  B --> F[SSE Clients]
:::

⸻

2. Low-Level Design (LLD)

2.1 Components and Responsibilities

2.1.1 Monolith API
• Handles HTTP requests (e.g., POST /order)
• Writes geospatial data with GEOADD
• Emits events to Redis Streams using XADD
• Maintains SSE connections to push updates to clients

2.1.2 Redis
• Stores location data using GEOADD, queried via GEORADIUS / GEOSEARCH
• Streams events like order_created and order_completed

2.1.3 Background Workers
• Read messages from Redis Streams via XREADGROUP
• Perform business logic (e.g., match driver, process payments)
• Write back results to another Redis Stream or Pub/Sub

2.1.4 SSE Manager (in Monolith)
• Holds client connections in memory (Map<userId, Response>)
• Pushes messages to clients when events are consumed from Redis Stream

2.2 LLD Diagram (Mermaid)

<!-- prettier-ignore -->
```mermaid
graph TD
  subgraph Client
    A1[POST /order] --> B1
    A2[SSE Connected] <-- B4
  end

  subgraph API (Monolith)
    B1[Receive Order Request] --> C1[XADD order_created]
    C2[XREADGROUP order_completed] --> B3[Push to SSE]
    B3 --> B4[SSE Stream to Client]
  end

  subgraph Redis
    C1
    C2
  end

  subgraph Worker
    D1[XREADGROUP order_created] --> D2[Process Order]
    D2 --> C2[XADD order_completed]
  end
```

⸻

3. Technology Stack

Component Technology
API Server NestJS / Express
Event Bus Redis Streams
Geospatial Index Redis GEO
Persistence PostgreSQL / MySQL
Background Jobs Node.js Worker
Realtime Updates Server-Sent Events

# Ride Creation-to-Acceptance Flow

<!-- prettier-ignore -->
```mermaid
sequenceDiagram
    autonumber
    participant Rider
    participant Gateway as Gateway API
    participant Queue as BullMQ Queue
    participant Driver

    Rider->>Gateway: POST /gateway/v1/rides
    Gateway->>Gateway: Persist ride (status: requested)
    Gateway->>Queue: Enqueue route-estimate job
    Queue-->>Gateway: Distance, duration, fare
    Gateway->>Queue: Enqueue ProcessSelection job
    Queue-->>Gateway: Transition to assigned
    Gateway-->>Driver: Notify ride matched
    Gateway-->>Rider: Notify ride matched

    Driver->>Gateway: POST /gateway/v1/rides/:id/driver-accept
    Gateway->>Gateway: Validate driver & status
    Gateway->>Gateway: Transition requested/candidates->assigned (if needed)
    Gateway-->>Driver: Notify ride matched (idempotent)
    Gateway->>Gateway: Transition assigned->accepted
    Gateway-->>Rider: Notify driver accepted

    Rider->>Gateway: POST /gateway/v1/rides/:id/rider-accept
    Gateway->>Gateway: Validate rider & status (must be accepted)
    Gateway->>Gateway: Transition accepted->enroute
    Gateway-->>Driver: Notify rider confirmed
```

<!-- prettier-ignore -->
```mermaid
flowchart LR
  subgraph client
    A1[Rider App]
    A2[Driver App]
  end

  subgraph backend[Backend Services]
    G[Gateway Controller]
    Q[Redis ]
    T[Trip Tracker Service]
    DB[(PostgreSQL - trip_history)]
    C[Cache Redis GeoIndex - active_drivers]
  end

  A1 -->|Location ping every 5s| G
  A2 -->|Location ping every 3s| G

  G --> Q
  Q --> T
  T -->|Write batch| DB
  T -->|Update metrics| C


```
