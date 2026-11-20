import { create } from '@bufbuild/protobuf';
import {
  MessageSchema,
  MetaSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/core/v1/message_pb.js';
import {
  MessageMetadataValidationErrorCode,
  validateMessageMetadata,
} from './message-metadata.validator.js';

describe('validateMessageMetadata', () => {
  it('возвращает точный timestamp и Date', () => {
    const result = validateMessageMetadata(
      create(MessageSchema, {
        metadata: create(MetaSchema, { timestamp: 1_787_594_400_999n }),
      }),
    );

    expect(result).toEqual({
      valid: true,
      timestamp: 1_787_594_400_999n,
      recordedAt: new Date('2026-08-24T18:00:00.999Z'),
    });
  });

  it('не сверяет устаревший Meta.node_id: любой NodeId и его отсутствие принимаются', () => {
    for (const nodeId of [0n, 3n, 43n]) {
      const result = validateMessageMetadata(
        create(MessageSchema, {
          metadata: create(MetaSchema, {
            nodeId,
            timestamp: 1_787_594_400_999n,
          }),
        }),
      );
      expect(result.valid).toBe(true);
    }
  });

  it('отклоняет нулевой timestamp из отсутствующих метаданных', () => {
    expect(validateMessageMetadata(create(MessageSchema, {}))).toEqual({
      valid: false,
      code: MessageMetadataValidationErrorCode.InvalidTimestamp,
    });
  });
});
