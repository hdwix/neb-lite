# Ride Creation-to-Acceptance Flow

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

The diagram traces how the gateway coordinates ride creation, background queue processing, and the mutual handshake between driver and rider before the trip starts.

## Handling multiple driver candidates

The current workflow always targets a **single** driver per ride:

* `CreateRideDto` requires a `driverId`, so a ride is created with exactly one intended driver rather than a pool of candidates.
* The queue workflow (`RideProcessor.handleRideWorkflow`) and driver acceptance endpoint both transition the ride to `ASSIGNED` for that specific `driverId` and then send a `ride.matched` notification to that same driver.
* Subsequent notifications (`ride.driver.accepted`, `ride.rider.confirmed`, and cancellation events) also look up the single `driverId` on the ride entity, so there is no fan-out to other drivers and no concept of notifying “losing” candidates.

To support several eligible drivers you would need additional state (for example, a candidate table or an array of `driverIds`) plus explicit notification fan-out. Each candidate would require its own channel via `NotificationPublisher.emit('driver', candidateId, ...)`, and once one driver accepts you would send a follow-up notification to the remaining candidates telling them the offer was withdrawn before clearing their pending jobs. None of that logic exists in the current codebase, so today only the pre-selected driver is ever contacted or updated about the ride.
