/**
 * Types for the subset of the KeeperHub REST API that is documented at
 * https://docs.keeperhub.com/api and confirmed via KeeperHub's own public
 * README (https://github.com/KeeperHub/keeperhub). See
 * docs/keeperhub-integration.md for the full research trail, what is
 * verified vs. still open, and why nothing beyond this subset is wired up
 * yet.
 *
 * Do not add fields/endpoints here speculatively - if it isn't confirmed
 * against KeeperHub's docs or dashboard response shapes, it doesn't belong
 * in this client.
 */

export interface KeeperHubWorkflow {
  id: string;
  name: string;
  status: string;
  chainId?: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface KeeperHubExecution {
  id: string;
  workflowId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface CreateWorkflowRequest {
  name: string;
  /**
   * Opaque workflow definition as accepted by KeeperHub's workflow builder
   * schema. Not modeled field-by-field here because that schema is not
   * fully published; callers must supply a definition built/verified
   * against the live KeeperHub dashboard or API response before use.
   */
  definition: Record<string, unknown>;
}
