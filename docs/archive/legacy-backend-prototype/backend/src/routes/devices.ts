import express, { Router, Request, Response } from 'express';

const router: Router = express.Router();
const devices: any[] = [];

router.post('/tokens', (req: Request, res: Response) => {
  const { token, platform, device_name } = req.body;
  const device = {
    id: `dev-${Date.now()}`,
    user_id: (req as any).user.id,
    token,
    platform,
    device_name,
    is_active: true,
    created_at: new Date(),
  };
  devices.push(device);
  res.status(201).json(device);
});

router.get('/my-devices', (req: Request, res: Response) => {
  const userDevices = devices.filter((d) => d.user_id === (req as any).user.id);
  res.json({ devices: userDevices });
});

router.delete('/:id', (req: Request, res: Response) => {
  const index = devices.findIndex((d) => d.id === req.params.id);
  if (index > -1) devices.splice(index, 1);
  res.json({ success: true });
});

// Send notification to all devices of user
export const sendNotification = (userId: string, notification: any) => {
  const userDevices = devices.filter((d) => d.user_id === userId && d.is_active);
  console.log(`Sending notification to ${userDevices.length} devices of user ${userId}`);
  return userDevices.length;
};

export default router;
