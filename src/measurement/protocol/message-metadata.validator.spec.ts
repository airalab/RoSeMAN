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
  it('возвращает точный timestamp и Date для совпадающего CPS NodeId', () => {
    const result = validateMessageMetadata(
      create(MessageSchema, {
        metadata: create(MetaSchema, {
          nodeId: 42n,
          timestamp: 1_787_594_400_999n,
        }),
      }),
      '42',
    );

    expect(result).toEqual({
      valid: true,
      nodeId: 42n,
      timestamp: 1_787_594_400_999n,
      recordedAt: new Date('2026-08-24T18:00:00.999Z'),
    });
  });

  it('отклоняет сообщение, заявившее другой CPS NodeId', () => {
    const result = validateMessageMetadata(
      create(MessageSchema, {
        metadata: create(MetaSchema, {
          nodeId: 43n,
          timestamp: 1_787_594_400_999n,
        }),
      }),
      '42',
    );

    expect(result).toEqual({
      valid: false,
      code: MessageMetadataValidationErrorCode.NodeIdMismatch,
    });
  });

  it('отклоняет нулевой timestamp из отсутствующих метаданных', () => {
    expect(validateMessageMetadata(create(MessageSchema, {}), '0')).toEqual({
      valid: false,
      code: MessageMetadataValidationErrorCode.InvalidTimestamp,
    });
  });
});
