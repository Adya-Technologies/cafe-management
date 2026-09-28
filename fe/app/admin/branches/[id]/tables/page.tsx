'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { tableService } from '@/lib/api/table-service';
import { branchService } from '@/lib/api/branch-service';
import { Branch, RestaurantTable } from '@/lib/types';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import Toast from '@/components/ui/Toast';

export default function BranchTablesPage() {
    const params = useParams();
    const branchId = params.id as string;

    const [branch, setBranch] = useState<Branch | null>(null);
    const [tables, setTables] = useState<RestaurantTable[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [newLabel, setNewLabel] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; isVisible: boolean }>({
        message: '',
        type: 'success',
        isVisible: false,
    });

    const loadData = useCallback(async () => {
        try {
            setIsLoading(true);
            const [branchData, tablesData] = await Promise.all([
                branchService.getBranch(branchId),
                tableService.listTables(branchId),
            ]);
            setBranch(branchData);
            setTables(tablesData);
        } catch {
            setToast({ message: 'Failed to load tables', type: 'error', isVisible: true });
        } finally {
            setIsLoading(false);
        }
    }, [branchId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleCreate = async () => {
        if (!newLabel.trim()) return;

        try {
            setIsCreating(true);
            const table = await tableService.createTable(branchId, newLabel.trim());
            setTables((prev) => [...prev, table]);
            setNewLabel('');
            setToast({ message: 'Table added', type: 'success', isVisible: true });
        } catch (error: unknown) {
            const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
            setToast({ message: message || 'Failed to add table', type: 'error', isVisible: true });
        } finally {
            setIsCreating(false);
        }
    };

    const handleToggleActive = async (table: RestaurantTable) => {
        try {
            const updated = await tableService.updateTable(table.id, { isActive: !table.isActive });
            setTables((prev) => prev.map((t) => (t.id === table.id ? updated : t)));
        } catch {
            setToast({ message: 'Failed to update table', type: 'error', isVisible: true });
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await tableService.deleteTable(id);
            setTables((prev) => prev.filter((t) => t.id !== id));
            setDeleteConfirm(null);
            setToast({ message: 'Table deleted', type: 'success', isVisible: true });
        } catch {
            setToast({ message: 'Failed to delete table', type: 'error', isVisible: true });
        }
    };

    const handleDownloadQR = (table: RestaurantTable) => {
        if (table.qrCode) {
            tableService.downloadQRCode(table.qrCode, table.label);
            return;
        }
        setToast({ message: 'No QR code available for this table', type: 'error', isVisible: true });
    };

    if (isLoading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-5xl">
            <Toast
                message={toast.message}
                type={toast.type}
                isVisible={toast.isVisible}
                onClose={() => setToast({ ...toast, isVisible: false })}
            />

            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Tables</h1>
                    <p className="text-gray-600">{branch?.name} &middot; each table gets its own QR code</p>
                </div>
                <Link href="/admin/branches">
                    <Button variant="ghost">Back to Branches</Button>
                </Link>
            </div>

            <div className="mb-6 flex gap-3">
                <div className="max-w-xs flex-1">
                    <Input
                        placeholder="Table label, e.g. 5 or Patio-2"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    />
                </div>
                <Button onClick={handleCreate} disabled={isCreating || !newLabel.trim()}>
                    {isCreating ? 'Adding...' : 'Add Table'}
                </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tables.map((table) => (
                    <div
                        key={table.id}
                        className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                    >
                        <div className="mb-3 flex items-center justify-between">
                            <p className="text-lg font-semibold text-gray-900">Table {table.label}</p>
                            <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                    table.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                                }`}
                            >
                                {table.isActive ? 'Active' : 'Disabled'}
                            </span>
                        </div>

                        <div className="mb-3 rounded-md bg-gray-50 p-4 text-center">
                            {table.qrCode ? (
                                <Image
                                    src={table.qrCode}
                                    alt={`Table ${table.label} QR Code`}
                                    width={120}
                                    height={120}
                                    className="mx-auto h-[120px] w-[120px] object-contain"
                                />
                            ) : (
                                <p className="text-sm text-gray-500">No QR code</p>
                            )}
                        </div>

                        <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => handleDownloadQR(table)}>
                                Download QR
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleToggleActive(table)}>
                                {table.isActive ? 'Disable' : 'Enable'}
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => setDeleteConfirm(table.id)}>
                                Delete
                            </Button>
                        </div>
                    </div>
                ))}
            </div>

            {tables.length === 0 && (
                <div className="rounded-lg border border-gray-200 bg-white py-16 text-center">
                    <p className="text-xl font-semibold text-gray-900">No tables yet</p>
                    <p className="mt-2 text-gray-600">Add a table above to generate its QR code.</p>
                </div>
            )}

            <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="Delete Table">
                <p className="mb-6 leading-relaxed text-gray-300">
                    Are you sure you want to delete this table? Its QR code will stop working immediately.
                </p>
                <div className="flex justify-end gap-3">
                    <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
                        Delete Table
                    </Button>
                </div>
            </Modal>
        </div>
    );
}
