/**
 * Channel constants, replayed locally with provenance.
 *
 * Provenance: pi-background-tasks src/core/host-protocol.ts:14-16
 *   HOST_REQUEST_CHANNEL  = 'pi-background-tasks:host:request:v1'
 *   HOST_RESPONSE_CHANNEL = 'pi-background-tasks:host:response:v1'
 *   HOST_CHANGED_CHANNEL  = 'pi-background-tasks:host:changed:v1'
 * (extension-api.ts:12-14 carries the parallel non-host trio
 *  pi-background-tasks:{request,response,terminal}:v1.)
 *
 * Replayed here so agent-hub needs no npm dep on pi-background-tasks
 * sources. If upstream bumps the :v1 tag, update these strings.
 */
export const HOST_REQUEST_CHANNEL = "pi-background-tasks:host:request:v1";
export const HOST_RESPONSE_CHANNEL = "pi-background-tasks:host:response:v1";
export const HOST_CHANGED_CHANNEL = "pi-background-tasks:host:changed:v1";
