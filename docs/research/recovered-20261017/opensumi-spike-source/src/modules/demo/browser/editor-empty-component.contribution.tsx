import React from 'react';
import {
  ComponentContribution,
  ComponentRegistry,
  Domain,
} from '@opensumi/ide-core-browser';

import styles from './editor-empty-component.module.less';

export const EditorEmptyComponent = () => (
  <main className={styles.kforgeHome} aria-label="KNOuX Forge workbench">
    <section className={styles.hero}>
      <div className={styles.mark}>K</div>
      <div>
        <p className={styles.eyebrow}>KNOuX ENGINEERING SYSTEM</p>
        <h1>KNOuX Forge</h1>
        <p className={styles.subtitle}>
          Local-first engineering command center inside an OpenSumi workbench spike.
        </p>
      </div>
    </section>

    <section className={styles.grid}>
      <article>
        <span>PROJECTS</span>
        <strong>Explorer + project intelligence</strong>
        <p>Open a real workspace and keep KForge discovery as the source of truth.</p>
      </article>
      <article>
        <span>RUNTIME</span>
        <strong>Preview + terminal</strong>
        <p>Workbench docking is supplied by OpenSumi; KForge owns runtime orchestration.</p>
      </article>
      <article>
        <span>AI</span>
        <strong>Agents + Inspector</strong>
        <p>The next slice moves canonical KForge AI context into the auxiliary area.</p>
      </article>
      <article>
        <span>QUALITY</span>
        <strong>Security + tests + release</strong>
        <p>No fake green states. Existing KForge evidence contracts remain authoritative.</p>
      </article>
    </section>

    <footer>
      PHASE 2 SPIKE · SHELL COMPATIBILITY ONLY
    </footer>
  </main>
);

@Domain(ComponentContribution)
export class EditorEmptyComponentContribution implements ComponentContribution {
  registerComponent(registry: ComponentRegistry) {
    registry.register('editor-empty', {
      id: 'empty-component',
      component: EditorEmptyComponent,
      initialProps: {},
    });
  }
}
