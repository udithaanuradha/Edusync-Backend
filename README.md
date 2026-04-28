# EduSync Backend (Node.js + Express + MySQL/TiDB)

Looking for UI setup and frontend pages? See the Frontend repository: [EduSync Frontend](https://github.com/udithaanuradha/Edusync)

This repository contains only the backend API and database integration for EduSync.

## Tech Stack

- Node.js
- Express
- mysql2
- TiDB/MySQL-compatible database
- Multer + Cloudinary (file uploads)

## Getting Started

### 1. Prerequisites

- Node.js 18+ recommended
- npm
- Access to TiDB/MySQL database
- Cloudinary account (for stage file uploads)

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Create a `.env` file in the backend root.

Example:

```env
PORT=5000

DB_HOST=gateway01.ap-southeast-1.prod.aws.tidbcloud.com
DB_PORT=4000
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=test

CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

### 4. Run server (development)

```bash
npm run dev
```

### 5. Run server (production mode)

```bash
npm start
```

Server default URL:

`http://localhost:5000`

## Scripts

- `npm run dev` - start with nodemon
- `npm start` - start with node

## Project Structure

```text
src/
	config/
		db.js                  Database connection pool
		cloudinaryConfig.js    Cloudinary + multer setup
	controllers/
		userController.js      User search and supervisor search handlers
		projectController.js   Stage CRUD and file upload logic
		groupController.js     Group creation and group listing
	middleware/
		authMiddleware.js      Token/role middleware used by protected routes
	models/
		projectModel.js        Stage data access
	routes/
		userRoutes.js
		projectRoutes.js
		groupRoutes.js
index.js                  App bootstrap and route mounting
```

## Database Notes

This backend uses these main tables:

- `users`
- `project_stages`
- `stage_files`
- `project_groups`
- `group_requests`
- `project_group_members` (auto-created by backend if missing)

Important:

- `project_group_members` is created automatically by the group controller on first use.
- Ensure your `users` table includes role and level data used by group validation.

## API Overview

### Auth

- `POST /api/login`
- `POST /api/signup`

### Admin

- `GET /api/admin/stats`
- `PUT /api/admin/promote-students`

### Users

- `GET /api/users/search?uniId=<index>&level=<1-4>`
	- Search one student by university ID and level
- `GET /api/users/supervisors?search=<name_or_email>`
	- Search supervisors for coordinator group creation

### Project Stages

- `GET /api/projects/level/:level`
- `GET /api/projects/:id`
- `POST /api/projects/create`
- `PUT /api/projects/update/:id`
- `DELETE /api/projects/delete/:id`
- `POST /api/projects/upload-file`
- `GET /api/projects/files/:stage_id`

### Groups

- `GET /api/groups/level/:level`
	- Returns groups with supervisor, leader, and member list
- `POST /api/groups/create`
	- Creates group with exactly 5 student members and one leader

Example request body for group creation:

```json
{
	"groupName": "Innovex",
	"level": 4,
	"supervisorId": 7,
	"leaderId": 31,
	"memberIds": [31, 33, 34, 35, 36]
}
```

## Integration Notes (Frontend)

- Frontend should point to this backend via `VITE_API_URL` (if used) and API base `http://localhost:5000`.
- Supervisor search in coordinator popup expects `GET /api/users/supervisors?search=`.
- Group creation uses `POST /api/groups/create`.

## Troubleshooting

### `Cannot GET /api/...`

- Route is missing or server is running old code.
- Restart backend after pulling new changes.

### Frontend shows `Unexpected token '<' ... is not valid JSON`

- Backend returned HTML (often 404 page) instead of JSON.
- Check route path and backend logs.

### Database connection errors

- Verify `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- Ensure TiDB/MySQL network access is allowed for your IP.

## Team Workflow Note

This repo is backend-only by design. Keep UI, route-level view logic, and frontend assets in the frontend repository.