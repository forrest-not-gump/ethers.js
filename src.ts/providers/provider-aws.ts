/**
 *  [[link-aws]] provides the Amazon Managed Blockchain Access service for connecting
 *  to public blockchains over JSON-RPC.
 *
 *  **Supported Networks**
 *
 *  - Ethereum Mainnet (``mainnet``)
 *  - Goerli Testnet (``goerli``)
 *  - Polygon (``matic``)
 *  - Polygon Mumbai Testnet (``matic-mumbai``)
 *
 *  @_subsection: api/providers/thirdparty:AWS  [providers-aws]
 */
import { FetchRequest, assertArgument } from "../utils/index.js";
import { Network, Networkish } from "./network.js";
import { JsonRpcProvider } from "./provider-jsonrpc.js";
import type { AbstractProvider } from "./abstract-provider.js";

import * as aws from "aws-sdk";
import * as sigv4 from "@aws-sdk/signature-v4";
import * as crypto from "@aws-crypto/sha256-js";
import * as http from "@aws-sdk/protocol-http";

/**
 * Returns the community Amazon Managed Blockchain node ID and region for the given %%network%%
 */
function getCommunityAmbNodeProps(network: Network): {
  nodeId: string;
  nodeRegion: string;
} {
  switch (network.name) {
    case "mainnet":
      assertArgument(
        false,
        "No Amazon Managed Blockchain community node found for network",
        "network.name",
        network.name
      );
    case "goerli":
      assertArgument(
        false,
        "No Amazon Managed Blockchain community node found for network",
        "network.name",
        network.name
      );
    case "matic":
      assertArgument(
        false,
        "No Amazon Managed Blockchain community node found for network",
        "network.name",
        network.name
      );
    case "matic-mumbai":
      assertArgument(
        false,
        "No Amazon Managed Blockchain community node found for network",
        "network.name",
        network.name
      );
    default:
      assertArgument(
        false,
        "Unsupported network",
        "network.name",
        network.name
      );
  }
}

/**
 * Returns the Amazon Managed Blockchain node URL for the given %%network%%
 */
function getAmbNodeUrl(
  nodeId: string,
  nodeRegion: string,
  billingToken?: string
): string {
  let url = `https://${nodeId}.ethereum.managedblockchain.${nodeRegion}.amazonaws.com`;

  if (billingToken) {
    url += `?billingToken=${billingToken}`;
  }

  return url;
}

/**
 * **AwsProvider** inputs
 */
type AwsProviderProps = {
  nodeId: string;
  nodeRegion: string;
  billingToken?: string;
  network?: Networkish;
  credentials?: aws.Credentials;
};

/**
 *  The **AwsProvider** connects to the [[link-aws]] JSON-RPC endpoints.
 *
 *  You must have an AWS account and the infrastructure deployed to enable authentication with AWS.
 *  See [this blog post]() for more details.
 */
export class AwsProvider extends JsonRpcProvider {
  readonly aws!: {
    nodeRegion: string;
    nodeId: string;
    nodeHttpEndpoint: string;
    credentials: aws.Credentials;
  };

  /**
   * Uses the AWS SDK to get AWS Credentials from the environment.
   * For details on how to configure your environment with AWS credentials,
   * see https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html
   */
  static getDefaultAwsCredentials(): aws.Credentials {
    const { credentials } = new aws.Config();

    if (credentials) {
      return credentials as aws.Credentials;
    }

    throw new Error(
      "AWS Credentials not found by the AWS SDK. To learn how to set AWS credentials for your environment, please visit https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html"
    );
  }

  /**
   *  Returns a FetchRequest to the %%network%% signed with the AWS %%credentials%%
   */
  static getFetchRequest(
    credentials: aws.Credentials,
    nodeId: string,
    nodeRegion: string,
    billingToken?: string
  ): FetchRequest {
    // Build an authenticated AWS HTTP request with FetchRequest

    const request = new FetchRequest(
      getAmbNodeUrl(nodeId, nodeRegion, billingToken)
    );

    /**
     * Updates the FetchRequest with the AWS SigV4 HTTP headers.
     * Runs before each FetchRequest.
     */
    request.preflightFunc = async (ethersRequest: FetchRequest) => {
      // Parse the FetchRequest properties into AWS HTTP Request Options used to build a signed AWS HTTP Request

      const urlParser = new URL(ethersRequest.url);
      const requestOptions = {
        protocol: urlParser.protocol,
        hostname: urlParser.hostname,
        method: ethersRequest.method,
        headers: { host: urlParser.host },
        path: urlParser.pathname,
        body: ethersRequest.body
          ? new TextDecoder().decode(ethersRequest.body)
          : undefined,
      };

      // Create the AWS HTTP Request with the FetchRequest properties

      const awsRequest = new http.HttpRequest(requestOptions);

      // Sign the request

      const signerV4 = new sigv4.SignatureV4({
        credentials,
        region: nodeRegion,
        service: "managedblockchain",
        sha256: crypto.Sha256,
      });

      const signedAwsRequest = await signerV4.sign(awsRequest, {
        signingDate: new Date(),
      });

      // Add the signed AWS HTTP request headers to the FetchRequest headers

      const { headers: signedAwsHeaders } = signedAwsRequest;

      for (const [headerKey, headerValue] of Object.entries(signedAwsHeaders)) {
        ethersRequest.setHeader(headerKey, headerValue);
      }

      return ethersRequest;
    };

    return request;
  }

  constructor({
    nodeId,
    nodeRegion,
    billingToken,
    network,
    credentials,
  }: AwsProviderProps) {
    // Get the Network

    if (network === undefined) {
      network = "mainnet";
    }

    network = Network.from(network);

    // Get the Amazon Managed Blockchain Node ID and Region

    if (!nodeId && nodeRegion) {
      assertArgument(
        false,
        "nodeId required with nodeRegion",
        "nodeId",
        nodeId
      );
    } else if (nodeId && !nodeRegion) {
      assertArgument(
        false,
        "nodeRegion required with nodeId",
        "nodeRegion",
        nodeRegion
      );
    } else if (!nodeId) {
      ({ nodeId, nodeRegion } = getCommunityAmbNodeProps(network));
    }

    // Get AWS credentials to sign HTTP requests with

    if (!credentials) {
      credentials = AwsProvider.getDefaultAwsCredentials();
    }

    // Get the FetchRequest to make JSON-RPC requests with

    const request = AwsProvider.getFetchRequest(
      credentials,
      nodeId,
      nodeRegion,
      billingToken
    );

    super(request, network, { staticNetwork: network });

    this.aws = {
      nodeRegion,
      nodeId,
      nodeHttpEndpoint: request.url,
      credentials,
    };
  }

  _getProvider(chainId: number): AbstractProvider {
    try {
      return new AwsProvider({
        network: chainId,
        nodeId: this.aws.nodeId,
        nodeRegion: this.aws.nodeRegion,
        credentials: this.aws.credentials,
      });
    } catch (error) {
      console.error(error);
    }

    return super._getProvider(chainId);
  }
}
