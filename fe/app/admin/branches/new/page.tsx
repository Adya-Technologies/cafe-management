'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { branchService } from '@/lib/api/branch-service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import BranchForm, { BranchFormData } from '@/components/admin/BranchForm';
import Button from '@/components/ui/Button';
import Toast from '@/components/ui/Toast';

export default function NewBranchPage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; isVisible: boolean }>({
        message: '',
        type: 'success',
        isVisible: false,
    });

    const handleSubmit = async (data: BranchFormData) => {
        try {
            setIsLoading(true);
            await branchService.createBranch({
                name: data.name,
                location: data.location,
                tokenSystemEnabled: data.tokenSystemEnabled,
                tokenRangeStart: data.tokenRangeStart,
                tokenRangeEnd: data.tokenRangeEnd,
                imageFile: data.imageFile,
            });

            setToast({
                message: 'Branch created successfully',
                type: 'success',
                isVisible: true,
            });

            setTimeout(() => {
                router.push('/admin/branches');
            }, 1000);
        } catch (error: unknown) {
            const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
            setToast({
                message: message || 'Failed to create branch',
                type: 'error',
                isVisible: true,
            });
        } finally {
            setIsLoading(false);
        }
    };

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
                    <h1 className="text-3xl font-bold text-black mb-2">Add Branch</h1>
                    <p className="text-black-400">Create a new cafe location</p>
                </div>
                <Link href="/admin/branches">
                    <Button >Back to List</Button>
                </Link>
            </div>

            <Card variant="glass">
                <CardHeader>
                    <CardTitle>Branch Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <BranchForm onSubmit={handleSubmit} isLoading={isLoading} />
                </CardContent>
            </Card>
        </div>
    );
}
