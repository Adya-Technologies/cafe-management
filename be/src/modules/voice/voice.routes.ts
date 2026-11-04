import { Router } from 'express';
import { VoiceController, voiceRateLimit } from './voice.controller';

const router: Router = Router();

// Public: customers talk to the assistant from the QR menu page.
router.post('/:branchId/assist', voiceRateLimit, VoiceController.assistValidation, VoiceController.assist);

export default router;
