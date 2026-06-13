# Bengaluru Traffic Simulator

## Vision

Build a web-based traffic simulation platform that overlays a realistic microscopic traffic model directly onto Bengaluru's road network. Users can zoom from city level down to individual intersections, modify traffic density on any road, and observe realistic vehicle movement, congestion formation, queue buildup, and network-wide traffic effects in real time.

The experience should feel like "Google Maps with a live traffic simulation engine."

---

## Core Features

### Real Bengaluru Map

* Use OpenStreetMap road network data.
* Support full Bengaluru coverage.
* Interactive zoom from city level to street level.
* Roads, lanes, intersections, and turn restrictions extracted from map data.

### Traffic Density Editing

Users can:

* Click any road segment.
* Set vehicle density (vehicles/hour).
* Configure vehicle mix:

  * Cars
  * Two-wheelers
  * Buses
  * Trucks
* Apply density changes instantly.

Example:

Outer Ring Road:

* 3000 vehicles/hour
* 60% cars
* 30% bikes
* 8% buses
* 2% trucks

### Real-Time Vehicle Simulation

* Every vehicle exists as an independent entity.
* Vehicles follow realistic driving behavior.
* No vehicle collisions.
* Lane changing supported.
* Queue formation at signals and bottlenecks.
* Congestion propagates naturally through the network.

### Bengaluru-Specific Behavior

Support different driver profiles:

* Conservative
* Average
* Aggressive
* Two-wheeler lane filtering

Two-wheelers should be capable of gap utilization and lane splitting where physically possible.

### Intersections & Signals

* Simulate traffic lights.
* Configurable signal timing.
* Support turning lanes and merging behavior.
* Users can edit signal phases while simulation is running.

### Heatmaps & Analytics

Visual layers:

* Congestion
* Average speed
* Vehicle density
* Queue length
* Travel time

Metrics update continuously during simulation.

### Scenario Management

Create and save scenarios:

* Morning Peak
* Airport Rush
* Rain Event
* Road Closure
* Stadium Event

Scenarios stored as portable JSON configurations.

---

## Simulation Engine

### Vehicle Model

Each vehicle maintains:

* Position
* Speed
* Acceleration
* Lane
* Route
* Driver profile

### Routing

* Road network represented as a graph.
* Vehicles receive origin and destination points.
* Dynamic route recalculation supported.

### Collision Avoidance

Use proven microscopic traffic models:

* IDM (car following)
* MOBIL (lane changing)

Vehicles must never overlap or collide.

---

## Scalability

### Viewport-Based Simulation

The engine dynamically adjusts simulation detail:

#### Street View

* Full microscopic simulation
* Individual vehicles rendered

#### Area View

* Hybrid simulation
* Aggregated traffic outside viewport

#### City View

* Network-level traffic modeling
* City-wide congestion visualization

This allows simulation of the entire Bengaluru road network while maintaining smooth performance.

---

## Rendering

### Technology

Frontend:

* React
* TypeScript
* MapLibre GL
* Deck.gl
* WebGL

### Performance Targets

* 100,000+ active vehicles
* 60 FPS rendering
* Real-time density updates
* Smooth zoom and pan

Vehicle rendering should use GPU instancing.

---

## Future Extensions

* Live traffic ingestion
* Weather effects
* Accident simulation
* Metro integration
* Bus route simulation
* AI signal optimization
* Infrastructure planning tools
* What-if analysis for flyovers, road widening, and closures

---

## Success Criteria

A user can open Bengaluru, zoom into any neighborhood, select a road, adjust traffic density, and instantly observe realistic, collision-free traffic behavior that scales from a single intersection to the entire city while maintaining interactive performance.

