'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { branchService } from '@/lib/api/branch-service';
import { Branch } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import BranchForm, { BranchFormData } from '@/components/admin/BranchForm';
import Button from '@/components/ui/Button';
import Toast from '@/components/ui/Toast';
import Spinner from '@/components/ui/Spinner';

export default function EditBranchPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;

    const [branch, setBranch] = useState<Branch | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; isVisible: boolean }>({
        message: '',
        type: 'success',
        isVisible: false,
    });

    const loadBranch = useCallback(async () => {
        try {
            setIsLoading(true);
            const data = await branchService.getBranch(id);
            setBranch(data);
        } catch {
            setToast({
                message: 'Failed to load branch details',
                type: 'error',
                isVisible: true,
            });
            setTimeout(() => {
                router.push('/admin/branches');
            }, 2000);
        } finally {
            setIsLoading(false);
        }
    }, [id, router]);

    useEffect(() => {
        loadBranch();
    }, [loadBranch]);

    const handleSubmit = async (data: BranchFormData) => {
        try {
            setIsSaving(true);
            await branchService.updateBranch(id, {
                name: data.name,
                location: data.location,
                tokenSystemEnabled: data.tokenSystemEnabled,
                tokenRangeStart: data.tokenRangeStart,
                tokenRangeEnd: data.tokenRangeEnd,
                imageFile: data.imageFile,
            });

            setToast({
                message: 'Branch updated successfully',
                type: 'success',
                isVisible: true,
            });

            setTimeout(() => {
                router.push('/admin/branches');
            }, 1000);
        } catch (error: unknown) {
            const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
            setToast({
                message: message || 'Failed to update branch',
                type: 'error',
                isVisible: true,
            });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Spinner size="lg" />
            </div>
        );
    }

    if (!branch) return null;

    return (
        <div className="max-w-2xl mx-auto">
            <Toast
                message={toast.message}
                type={toast.type}
                isVisible={toast.isVisible}
                onClose={() => setToast({ ...toast, isVisible: false })}
            />

            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Edit Branch</h1>
                    <p className="text-gray-900">Update location details and settings</p>
                </div>
                <Link href="/admin/branches">
                    <Button variant="ghost">Back to List</Button>
                </Link>
            </div>

            <Card variant="glass">
                <CardHeader>
                    <CardTitle>Branch Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <BranchForm
                        initialData={branch}
                        onSubmit={handleSubmit}
                        isLoading={isSaving}
                        isEdit={true}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
