import { Router } from 'express';
import { VoiceController, voiceRateLimit } from './voice.controller';
import { HOST_NAME } from './engines/claude-cli.engine';

const router: Router = Router();

// Public: lets the menu page greet guests with the configured host name.
router.get('/config', (_req, res) => {
    res.json({ hostName: HOST_NAME });
});

// Public: customers talk to the assistant from the QR menu page.
router.post('/:branchId/assist', voiceRateLimit, VoiceController.assistValidation, VoiceController.assist);

export default router;
