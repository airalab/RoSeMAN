import { Injectable, Logger } from '@nestjs/common';
import type { Codec } from '@polkadot/types/types';
import type { Event } from '@polkadot/types/interfaces';
import { readCpsNodeAt } from '../cps-node.reader.js';
import type { ChainEventHandler } from '../interfaces/chain-event-handler.interface.js';
import { RobonomicsService } from '../robonomics.service.js';
import { SensorProfileRepository } from '../../database/repositories/sensor-profile.repository.js';
import {
  decodeProfilePayload,
  parseProfileMeta,
} from '../../profile/profile-format.js';

interface CpsEventMatcher {
  is(event: Event): boolean;
}

interface RwsDevicesQuery {
  readonly query: {
    readonly rws?: {
      readonly devices?: (owner: string) => Promise<Codec & Iterable<Codec>>;
    };
  };
}

/**
 * `cps.PayloadSet` on a profile node → queue profile.json for pinning.
 *
 * A profile node carries meta {"t":"ss.profile","v":1,"sensor":…} and a binary CID payload.
 * It is accepted only when the node's Scope owner is the RWS subscription owner of that
 * sensor at the event block — the same trust rule as stories.
 */
@Injectable()
export class CpsProfileHandler implements ChainEventHandler {
  readonly name = 'cps-profile';
  readonly section = 'cps';
  readonly method = 'PayloadSet';

  private readonly logger = new Logger(CpsProfileHandler.name);

  constructor(
    private readonly robonomics: RobonomicsService,
    private readonly profiles: SensorProfileRepository,
  ) {}

  async handle(
    event: Event,
    blockNum: number,
    isSuccess: boolean,
  ): Promise<void> {
    if (!isSuccess) return;

    const api = await this.robonomics.getApi();
    const payloadSet = (
      api.events as unknown as { cps?: { PayloadSet?: CpsEventMatcher } }
    ).cps?.PayloadSet;
    if (!payloadSet?.is(event)) return;

    const nodeId = event.data[0];
    const blockHash = await api.rpc.chain.getBlockHash(blockNum);
    const node = await readCpsNodeAt(api, blockHash, nodeId);
    if (!node?.payload || !node.owner) return;

    const sensor = parseProfileMeta(node.meta);
    if (!sensor) return; // not a profile node: measurements and others are handled elsewhere

    let cid: string;
    try {
      cid = decodeProfilePayload(node.payload);
    } catch {
      this.logger.debug(
        `Block ${blockNum}: profile node ${nodeId.toString()} payload is not a CID`,
      );
      return;
    }

    const apiAt = (await api.at(blockHash)) as unknown as RwsDevicesQuery;
    const devicesQuery = apiAt.query.rws?.devices;
    if (!devicesQuery) return;
    const devices = [...(await devicesQuery(node.owner))].map((d) =>
      d.toString(),
    );
    if (!devices.includes(sensor)) {
      this.logger.debug(
        `Block ${blockNum}: profile for ${sensor} rejected — owner ${node.owner} has no such device`,
      );
      return;
    }

    const queued = await this.profiles.upsertPending({
      sensor_id: sensor,
      owner: node.owner,
      node_id: nodeId.toString(),
      block: blockNum,
      cid,
    });
    this.logger.log(
      `Block ${blockNum}: profile ${cid} for ${sensor} ${queued ? 'queued' : 'is older, skipped'}`,
    );
  }
}
