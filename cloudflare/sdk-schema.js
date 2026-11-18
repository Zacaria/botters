// The SDK's official edge validator replaces its code-generating Node default
// only in the Worker bundle. Node stdio keeps the SDK's normal validator.
export { CfWorkerJsonSchemaValidator as AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker'
