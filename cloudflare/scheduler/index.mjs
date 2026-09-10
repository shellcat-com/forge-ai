import { WorkflowEntrypoint } from 'cloudflare:workers'
import { createTriggerHandler } from '../../engine/scheduling/trigger.ts'
import { runDispatch } from '../../engine/scheduling/workflow.ts'

export class ForgeDispatch extends WorkflowEntrypoint {
  async run(event, step) {
    return runDispatch(event.payload, step, {
      enabled: this.env.FORGE_SCHEDULER_ENABLED === 'true',
      controlOrigin: this.env.FORGE_CONTROL_ORIGIN,
      stepSecret: this.env.FORGE_WORKER_STEP_KEY,
    })
  }
}

export default {
  async fetch(request, env) {
    return createTriggerHandler({
      enabled: env.FORGE_SCHEDULER_ENABLED === 'true',
      origin: env.FORGE_SCHEDULER_ORIGIN,
      secret: env.FORGE_SCHEDULER_TRIGGER_KEY,
      workflow: env.FORGE_DISPATCH,
    })(request)
  },
}
