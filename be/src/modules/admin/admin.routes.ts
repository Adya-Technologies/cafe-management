import { Router } from 'express';
import { AdminController } from './admin.controller';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { uploadEmployeeImage } from '../../middleware/upload';

const router: Router = Router();

// All admin routes require authentication
router.use(authenticate);

// Reports (accessible to admins and managers/staff)
router.get(
    '/reports/overview',
    requireRole('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
    AdminController.getReportOverview
);

// Employee Management
router.post(
    '/employees',
    requireRole('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
    uploadEmployeeImage.single('image'),
    AdminController.createEmployeeValidation,
    AdminController.createEmployee
);
router.get('/employees', requireRole('ADMIN', 'MANAGER', 'SUPER_ADMIN'), AdminController.listEmployees);
router.get('/employees/:id', requireRole('ADMIN', 'MANAGER', 'SUPER_ADMIN'), AdminController.getEmployee);
router.put(
    '/employees/:id',
    requireRole('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
    uploadEmployeeImage.single('image'),
    AdminController.updateEmployee
);
router.delete('/employees/:id', requireRole('ADMIN', 'MANAGER', 'SUPER_ADMIN'), AdminController.deleteEmployee);

// Branch Management
router.get('/branches', requireRole('ADMIN', 'MANAGER', 'SUPER_ADMIN'), AdminController.listBranches);
router.get('/branches/:id', requireRole('ADMIN', 'MANAGER', 'SUPER_ADMIN'), AdminController.getBranch);

// Table Management
router.get(
    '/branches/:branchId/tables',
    requireRole('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
    AdminController.listTables
);

// Everything below requires admin-only permissions
router.use(requireRole('ADMIN', 'SUPER_ADMIN'));
router.post('/branches', AdminController.createBranchValidation, AdminController.createBranch);
router.put('/branches/:id', AdminController.updateBranch);
router.delete('/branches/:id', AdminController.deleteBranch);

router.post(
    '/branches/:branchId/tables',
    AdminController.createTableValidation,
    AdminController.createTable
);
router.put('/tables/:id', AdminController.updateTable);
router.delete('/tables/:id', AdminController.deleteTable);

export default router;
