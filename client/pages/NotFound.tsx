import { Link } from "react-router-dom";
import { ArrowRight, Compass } from "lucide-react";

const NotFound = () => (
  <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
    <section className="w-full max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm" aria-labelledby="not-found-title">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Compass aria-hidden="true" className="text-muted-foreground" size={22} />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">KNOuX Forge</p>
      <h1 id="not-found-title" className="mt-2 text-2xl font-semibold">Route not found</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        The requested workbench route does not exist in this build. Your local projects and evidence were not changed.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" to="/workspace">
          <ArrowRight aria-hidden="true" size={16} /> Open workbench
        </Link>
        <Link className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium" to="/">
          Return to start
        </Link>
      </div>
    </section>
  </main>
);

export default NotFound;
