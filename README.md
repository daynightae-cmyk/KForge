
Built by https://www.blackbox.ai

---

# Fusion Starter

A production-ready full-stack React application template with an integrated Express server, featuring React Router 6 SPA mode, TypeScript, Vitest, Zod, and modern tooling.

## Project Overview

Fusion Starter is designed as a robust and efficient template for building modern web applications using React and Express. It leverages a variety of technologies to ensure a smooth development experience and a performant application. The template is built with TypeScript, making it type-safe, and is equipped with tools for testing and validation, such as Vitest and Zod.

## Installation

To set up the project locally, follow these steps:

1. **Clone the repository:**
   ```bash
   git clone <REPOSITORY_URL>
   cd fusion-starter
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

## Usage

To start the development server, use:

```bash
npm run dev
```

This command will run both the client and server on a single port (8080) with hot reloading enabled for rapid development. You can navigate to [http://localhost:8080](http://localhost:8080) to see your application in action.

## Features

- **Single Page Application (SPA):** Utilizes React Router 6 for client-side routing.
- **Type Safety:** Built with TypeScript, ensuring type checks at compile time.
- **Integrated Development:** Combines frontend and backend development in a single environment with Vite and Express.
- **Testing Suite:** Includes Vitest for unit testing.
- **Validation:** Utilizes Zod for runtime validation of data and schemas.
- **Comprehensive UI components:** Pre-built library of UI components using Radix UI and TailwindCSS 3.

## Dependencies

The project requires the following dependencies as specified in `package.json`:

- `express`: "^4.18.2"
- `zod`: "^3.23.8"
  
Development dependencies include:
- `@hookform/resolvers`
- `@radix-ui/*` components
- `@tanstack/react-query`
- `tailwindcss`
- Lots of types for better development experience with TypeScript.

## Project Structure

The project is structured as follows:

```
client/                   # React SPA frontend
├── pages/                # Route components (Index.tsx = home)
├── components/ui/        # Pre-built UI component library
├── App.tsx               # App entry point with SPA routing setup
└── global.css            # TailwindCSS theming and global styles

server/                   # Express API backend
├── index.ts              # Main server setup (express config + routes)
└── routes/               # API handlers

shared/                   # Types used by both client & server
└── api.ts                # Example of how to share API interfaces
```

## Development Commands

Here are some useful commands for development:

```bash
npm run dev        # Start dev server (client + server)
npm run build      # Production build
npm run start      # Start production server
npm run typecheck  # TypeScript validation
npm run test       # Run Vitest tests
```

## Adding Features

### To Add New Colors to the Theme:
- Open `client/global.css` and `tailwind.config.ts`, adding new Tailwind colors as needed.

### To Create a New API Route:
1. **Optional:** Create a shared interface in `shared/api.ts` for type safety.
2. Create a new route handler in `server/routes/<your-route>.ts`.
3. Register the route in `server/index.ts`.

### To Create a New Page Route:
1. Create a new component in `client/pages/<YourPage>.tsx`.
2. Add the corresponding route in `client/App.tsx`.

## Production Deployment

For production deployment, use:

```bash
npm run build  # To create a production build
npm start      # To start the production server
```

### Docker Support
- A Dockerfile is provided for containerized deployment. Customize as necessary for your production environment.

## Architecture Notes

- Single-port development with Vite + Express integration.
- Full TypeScript support across client, server, and shared code.
- Rapid development with hot reload capabilities.
- Multi-deployment options including standard builds and Docker containers.
- Comprehensive UI components and type-safe API communication through shared interfaces.

---

Feel free to contribute to the project, and for any issues or suggestions, raise a ticket in the repository.