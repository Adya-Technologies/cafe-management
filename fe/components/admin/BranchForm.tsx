'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Branch } from '@/lib/types';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Checkbox from '@/components/ui/Checkbox';
import { resolveImageUrl } from '@/lib/utils/image';

const branchSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    location: z.string().min(3, 'Location must be at least 3 characters'),
    tokenSystemEnabled: z.boolean(),
    tokenRangeStart: z.number().int().min(0).optional(),
    tokenRangeEnd: z.number().int().min(1).optional(),
}).refine((data) => {
    if (data.tokenSystemEnabled) {
        if (data.tokenRangeStart === undefined || data.tokenRangeEnd === undefined) {
            return false;
        }
        if (data.tokenRangeStart >= data.tokenRangeEnd) {
            return false;
        }
    }
    return true;
}, {
    message: "Token range start must be less than end, and both must be provided if token system is enabled",
    path: ["tokenRangeEnd"],
});

export type BranchFormData = z.infer<typeof branchSchema> & {
    imageFile?: File | null;
};

interface BranchFormProps {
    initialData?: Branch;
    onSubmit: (data: BranchFormData) => Promise<void>;
    isLoading: boolean;
    isEdit?: boolean;
}

export default function BranchForm({ initialData, onSubmit, isLoading, isEdit = false }: BranchFormProps) {
    const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(
        resolveImageUrl(initialData?.imageUrl || initialData?.avatar) ?? null
    );
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        return () => {
            if (imagePreviewUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(imagePreviewUrl);
            }
        };
    }, [imagePreviewUrl]);

    const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !file.type.startsWith('image/')) {
            return;
        }

        const nextPreviewUrl = URL.createObjectURL(file);
        setSelectedImageFile(file);
        setImagePreviewUrl((currentPreviewUrl) => {
            if (currentPreviewUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(currentPreviewUrl);
            }
            return nextPreviewUrl;
        });
    };

    const handleResetSelectedImage = () => {
        setSelectedImageFile(null);
        setImagePreviewUrl((currentPreviewUrl) => {
            if (currentPreviewUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(currentPreviewUrl);
            }
            return resolveImageUrl(initialData?.imageUrl || initialData?.avatar) ?? null;
        });

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const {
        register,
        handleSubmit,
        watch,
        formState: { errors },
    } = useForm<BranchFormData>({
        resolver: zodResolver(branchSchema),
        defaultValues: {
            name: initialData?.name || '',
            location: initialData?.location || '',
            tokenSystemEnabled: initialData?.tokenSystemEnabled ?? initialData?.hasTokenSystem ?? false,
            tokenRangeStart: initialData?.tokenRangeStart ?? (initialData?.tokenSystemEnabled ? 1 : undefined),
            tokenRangeEnd: initialData?.tokenRangeEnd ?? initialData?.maxTokenNumber ?? 999,
        },
    });

    // eslint-disable-next-line react-hooks/incompatible-library
    const tokenSystemEnabled = watch('tokenSystemEnabled');

    const handleFormSubmit = async (data: BranchFormData) => {
        await onSubmit({ ...data, imageFile: selectedImageFile });
    };

    return (
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
            <div className="space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border border-gray-300 bg-white">
                            {imagePreviewUrl ? (
                                <div
                                    className="h-full w-full bg-contain bg-center bg-no-repeat"
                                    style={{ backgroundImage: `url(${imagePreviewUrl})` }}
                                />
                            ) : (
                                <span className="text-xs text-gray-400">No logo</span>
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-gray-900">Branch Logo</p>
                            <p className="mt-1 text-xs text-gray-600">
                                Shown on the customer menu page and branch list. JPG, PNG, or WebP up to 5MB.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleImageChange}
                                    className="hidden"
                                />
                                <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                                    {imagePreviewUrl ? 'Change Logo' : 'Upload Logo'}
                                </Button>
                                {(selectedImageFile || initialData?.imageUrl) && (
                                    <Button type="button" variant="ghost" onClick={handleResetSelectedImage}>
                                        Reset
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <Input
                    label="Branch Name"
                    {...register('name')}
                    error={errors.name?.message}
                    placeholder="Downtown Cafe"
                />

                <Input
                    label="Location"
                    {...register('location')}
                    error={errors.location?.message}
                    placeholder="123 Main St, City"
                />

                <div className="pt-2">
                    <Checkbox
                        label="Enable Token System"
                        {...register('tokenSystemEnabled')}
                        id="tokenSystemEnabled"
                        labelClassName="text-black"
                    />
                    <p className="mt-1 text-sm text-black-500 ml-7">
                        If enabled, orders will be assigned a token number within the specified range.
                    </p>
                </div>

                {tokenSystemEnabled && (
                    <div className="grid grid-cols-2 gap-4 pl-7 border-l-2 border-gray-800 ml-2">
                        <Input
                            label="Start Token"
                            type="number"
                            {...register('tokenRangeStart', { valueAsNumber: true })}
                            error={errors.tokenRangeStart?.message}
                        />
                        <Input
                            label="End Token"
                            type="number"
                            {...register('tokenRangeEnd', { valueAsNumber: true })}
                            error={errors.tokenRangeEnd?.message}
                        />
                    </div>
                )}
            </div>

            <div className="flex justify-end gap-4 pt-4">
                <Button type="submit" isLoading={isLoading} fullWidth>
                    {isEdit ? 'Update Branch' : 'Create Branch'}
                </Button>
            </div>
        </form>
    );
}
