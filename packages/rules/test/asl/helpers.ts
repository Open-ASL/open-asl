import type { Action, Ctx, RuleModule } from '@asl/engine';
import { FP, type FireDeclaration, type FireMode, type ResolveFireFn } from '../../src';

/** Test-only action: resolve a fire declaration in a given mode (as in fire.test.ts). */
export const testFire: RuleModule = {
  id: 'test.fire',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: (env, a) => env.query('fire.illegal', { decl: a.decl, mode: a.mode, side: a.side }, null),
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
  },
};
