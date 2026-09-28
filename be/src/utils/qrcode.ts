import QRCode from 'qrcode';

export async function generateBranchQR(
    branchId: string,
    baseUrl: string
): Promise<string> {
    const menuUrl = `${baseUrl}/menu/${branchId}`;

    const qrCodeDataUrl = await QRCode.toDataURL(menuUrl, {
        width: 400,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#FFFFFF',
        },
        errorCorrectionLevel: 'M',
    });

    return qrCodeDataUrl;
}

export async function generateTableQR(
    branchId: string,
    tableId: string,
    label: string,
    baseUrl: string
): Promise<string> {
    const menuUrl = `${baseUrl}/menu/${branchId}?table=${tableId}&t=${encodeURIComponent(label)}`;

    return QRCode.toDataURL(menuUrl, {
        width: 400,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#FFFFFF',
        },
        errorCorrectionLevel: 'M',
    });
}

export async function generateQRBuffer(
    branchId: string,
    baseUrl: string
): Promise<Buffer> {
    const menuUrl = `${baseUrl}/menu/${branchId}`;

    const qrCodeBuffer = await QRCode.toBuffer(menuUrl, {
        width: 400,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#FFFFFF',
        },
        errorCorrectionLevel: 'M',
    });

    return qrCodeBuffer;
}
