# Sample Brief: Express REST API

## Objective
Build a production-ready REST API for managing client records.

## Requirements
- Express.js server on port 3000
- SQLite database via better-sqlite3
- CRUD endpoints: GET/POST/PUT/DELETE /api/clients
- Client schema: id, name, email, phone, company, created_at, updated_at
- Input validation (reject missing required fields, invalid emails)
- Error handling middleware (catch-all, proper HTTP status codes)
- Health check: GET /api/health returns { status: "ok", uptime: ... }
- CORS enabled
- Request logging (morgan)

## Acceptance Criteria
- All dependencies installed and listed in package.json
- Server starts without errors
- Each endpoint tested with at least one curl/http_request call
- Database file created automatically on first run
- Clean, documented code with JSDoc comments

## Constraints
- Node.js only, no TypeScript
- No external database servers — SQLite file-based only
- Must work offline (no external API dependencies)
