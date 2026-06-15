# Real-Time Chat Application — Backend

Lightweight backend for a real-time chat application built with NestJS, Prisma and WebSockets.

## Features

- REST + WebSocket (Socket.IO) APIs for messaging and presence
- User registration, authentication (JWT), refresh tokens
- Profiles, message storing, blocking, typing indicators
- Cloudinary integration for media uploads
- Email (verification, reset) integration

## Tech stack

- Node.js 18+ / TypeScript
- NestJS
- Prisma ORM (Postgres)
- Socket.IO (WebSockets)
- Cloudinary, SendGrid / SMTP (email)

## Quick start

1. Install dependencies

```bash
npm install
```

2. Create a `.env` file (see example below) and set your secrets

3. Generate Prisma client and run migrations

```bash
npx prisma generate
npx prisma migrate dev
```

4. Run in development

```bash
npm run start:dev
```

## Environment variables (example)

Create a `.env` with at least:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret
PORT=3000
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
EMAIL_FROM=...
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
```

## Database

This project uses Prisma. Define your `DATABASE_URL` then run:

```bash
npx prisma migrate dev --name init
npx prisma generate
```

Migrations are stored in the `prisma/migrations` folder.

## WebSocket / Gateway

- The real-time gateway is implemented in `src/chat/chat.gateway.ts` and guarded by a WS JWT guard.
- Clients should connect using the same JWT used for HTTP requests and follow the event shapes defined in `src/chat/dto`.

## Running tests

```bash
npm run test
npm run test:e2e
```

## Useful commands

- Start (dev): `npm run start:dev`
- Build: `npm run build`
- Start (prod): `npm run start:prod`
- Prisma Studio: `npx prisma studio`

## Contributing

Contributions, bug reports and feature requests are welcome. Please open an issue or a pull request describing the change.

## Files of interest

- `src/chat` — WebSocket gateway and chat service
- `src/auth` — authentication and token handling
- `prisma/schema.prisma` — data model and relations

## License

This repository follows the original project's license. See the `LICENSE` file if present.
