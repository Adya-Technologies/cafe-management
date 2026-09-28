'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { branchService } from '@/lib/api/branch-service';
import { Branch } from '@/lib/types';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import Toast from '@/components/ui/Toast';

export default function BranchesPage() {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; isVisible: boolean }>({
        message: '',
        type: 'success',
        isVisible: false,
    });

    useEffect(() => {
        loadBranches();
    }, []);

    const loadBranches = async () => {
        try {
            setIsLoading(true);
            const data = await branchService.getBranches();
            setBranches(data);
        } catch (error) {
            console.error('Failed to load branches:', error);
            setToast({
                message: 'Failed to load branches',
                type: 'error',
                isVisible: true,
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await branchService.deleteBranch(id);
            setBranches(branches.filter((branch) => branch.id !== id));
            setDeleteConfirm(null);
            setToast({
                message: 'Branch deleted successfully',
                type: 'success',
                isVisible: true,
            });
        } catch (error: unknown) {
            const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
            setToast({
                message: message || 'Failed to delete branch',
                type: 'error',
                isVisible: true,
            });
        }
    };

    const handleDownloadQR = (branch: Branch) => {
        if (branch.qrCode) {
            branchService.downloadQRCode(branch.qrCode, branch.name);
            return;
        }

        setToast({
            message: 'No QR code available for this branch',
            type: 'error',
            isVisible: true,
        });
    };

    if (isLoading) {
        return (
            <div className="min-h-[70vh] bg-[#efe8cf] px-4 py-6">
                <div className="mx-auto max-w-7xl rounded-md border border-[#e3dcc4] bg-[#efe8cf] p-5">
                    <div className="flex h-64 items-center justify-center">
                        <Spinner size="lg" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-[70vh] bg-[#efe8cf] px-4 py-6">
            <Toast
                message={toast.message}
                type={toast.type}
                isVisible={toast.isVisible}
                onClose={() => setToast({ ...toast, isVisible: false })}
            />

            <div className="mx-auto max-w-7xl rounded-md border border-[#e3dcc4] bg-[#efe8cf] p-3 sm:p-5">
                <div className="mb-6 flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xl font-semibold leading-tight text-[#1f1c17]">Dashboard</p>
                        <h1 className="mt-2 text-3xl font-bold leading-tight text-[#15120f]">Select a Branch</h1>
                    </div>
                    <Link href="/admin/branches/new">
                        <Button className="bg-[#6b3b2f] text-[#f7f3e6] hover:bg-[#5d3127]">
                            <PlusIcon className="mr-2 h-5 w-5" />
                            Add Branch
                        </Button>
                    </Link>
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    {branches.map((branch) => (
                        <div key={branch.id} className="rounded-lg bg-[#643427] p-4 shadow-[0_1px_6px_rgba(0,0,0,0.22)]">
                            <Link href={`/admin/branches/${branch.id}`} className="block">
                                <div className="mb-4 rounded-md bg-[#f4f3ef] p-8 text-center shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
                                    {branch.qrCode ? (
                                        <Image
                                            src={branch.qrCode}
                                            alt={`${branch.name} QR Code`}
                                            width={104}
                                            height={104}
                                            className="mx-auto h-[104px] w-[104px] rounded object-contain"
                                        />
                                    ) : (
                                        <p className="truncate text-xl font-semibold text-[#1d1a16]">{branch.name}</p>
                                    )}
                                </div>
                            </Link>

                            <p className="truncate px-1 text-2xl font-semibold text-[#f1e8d6]">
                                {branch.name}, {branch.location}
                            </p>

                            <div className="mt-4 flex gap-2">
                                <Link href={`/admin/branches/${branch.id}/tables`} className="flex-1">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="w-full border-[#eadcc7] text-white hover:bg-[#73463a]"
                                    >
                                        Tables
                                    </Button>
                                </Link>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1 border-[#eadcc7] text-white hover:bg-[#73463a]"
                                    onClick={() => handleDownloadQR(branch)}
                                >
                                    <DownloadIcon className="mr-1.5 h-4 w-4" />
                                    QR
                                </Button>
                                <Button
                                    variant="danger"
                                    size="sm"
                                    className="px-3"
                                    onClick={() => setDeleteConfirm(branch.id)}
                                >
                                    <TrashIcon className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>

                {branches.length === 0 && (
                    <div className="rounded-lg border border-[#d4c9ab] bg-[#f3ebd2] py-16 text-center">
                        <p className="text-2xl font-semibold text-[#2a241d]">No branches found</p>
                        <p className="mt-2 text-[#56473a]">Create your first branch to get started.</p>
                        <Link href="/admin/branches/new">
                            <Button className="mt-6 bg-[#6b3b2f] text-[#f7f3e6] hover:bg-[#5d3127]">
                                <PlusIcon className="mr-2 h-5 w-5" />
                                Add Branch
                            </Button>
                        </Link>
                    </div>
                )}
            </div>

            <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="Delete Branch">
                <p className="mb-6 leading-relaxed text-gray-300">
                    Are you sure you want to delete this branch? All associated employees, menu items, and orders data
                    may be affected.
                </p>
                <div className="flex justify-end gap-3">
                    <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
                        Delete Branch
                    </Button>
                </div>
            </Modal>
        </div>
    );
}

function PlusIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
    );
}

function DownloadIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
    );
}

function TrashIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
    );
}
