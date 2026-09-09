> מקור: https://www.workflowbuilder.io/docs/guides/save-diagrams-to-database/
> נשמר: 2026-09-09

# Save Diagrams to Database

A minimal example of persisting Workflow Builder diagrams to a backend database.

This example shows the minimal steps to save and load a diagram from a database using the API integration strategy.

## Backend endpoint

You need two endpoints. The exact implementation depends on your stack - here’s a simple Node.js/Express example:
```typescript
import express from 'express';

const app = express();
app.use(express.json());

// In-memory store (replace with your database)
let savedDiagram = null;

// Load diagram
app.get('/api/workflow', (request, response) => {
  response.json(savedDiagram ?? {});
});

// Save diagram
app.post('/api/workflow', (request, response) => {
  savedDiagram = request.body;
  response.json({ ok: true });
});
```
## Frontend integration

 Tip

File paths in this guide are relative to the [Standalone App](https://www.workflowbuilder.io/docs/get-started/quick-start/standalone-app/) repository structure. If you embedded Workflow Builder differently, adjust the paths to match your project layout.

Use the API integration strategy in Workflow Builder and point it at your endpoints:

integration-variants/with-integration-through-api.tsx
```typescript
// <root>/features/integration/components/
// Load - replace the fetch URL:
const response = await fetch('/api/workflow');

// Save - replace the fetch URL and method:
const response = await fetch('/api/workflow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
```
## The diagram data

The `data` object POSTed to your API has this shape:
```json
{
  "name": "My Workflow",
  "layoutDirection": "DOWN",
  "nodes": [
    {
      "id": "abc-123",
      "type": "node",
      "position": { "x": 100, "y": 200 },
      "data": {
        "type": "trigger",
        "icon": "Lightning",
        "properties": {
          "label": "Start",
          "description": "Trigger"
        }
      }
    }
  ],
  "edges": []
}
```
Store this as a JSON column in your database. No transformation is needed - load it back as-is to restore the diagram.

## Storing multiple diagrams

To support multiple diagrams per user, add a diagram ID to the endpoint:
```plaintext
GET  /api/workflows/:id
POST /api/workflows/:id
```
Pass the ID to the integration wrapper or manage it in your parent component using the [through props](https://www.workflowbuilder.io/docs/get-started/persistence/callback/) strategy.

## See also

- [REST API persistence](https://www.workflowbuilder.io/docs/get-started/persistence/rest-api/) - load and save diagrams from a backend REST API

- [via callback persistence](https://www.workflowbuilder.io/docs/get-started/persistence/callback/) - pass diagram data and save callbacks as React props

- [Diagram state management](https://www.workflowbuilder.io/docs/overview/features/diagram-state-management/) - canvas state, undo/redo, and auto-save

Need help wiring this up to a real database, auth, or multi-user setup? [Contact us](https://www.workflowbuilder.io/contact) — we’ve built end-to-end persistence layers for production deployments.

[Previous Use Variable Picker](https://www.workflowbuilder.io/docs/guides/use-variable-picker/)
[Next Node schemas](https://www.workflowbuilder.io/docs/node-schemas/)
