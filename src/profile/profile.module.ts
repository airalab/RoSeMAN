import { Module } from '@nestjs/common';
import { KuboClient } from './kubo-client.js';
import { ProfileController } from './profile.controller.js';
import { ProfilePinService } from './profile-pin.service.js';

/** Read API: GET /api/v2/profile/:sensor_id and /api/v2/profile/image/:cid */
@Module({
  controllers: [ProfileController],
  providers: [KuboClient],
})
export class ProfileApiModule {}

/** Pin queue: pulls pending profiles from the phone through Kubo (PROFILE_ENABLED=true). */
@Module({
  providers: [KuboClient, ProfilePinService],
})
export class ProfilePinModule {}
