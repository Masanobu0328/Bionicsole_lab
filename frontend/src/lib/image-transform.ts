type ImageTransform = {
    rotation: number;
    flipX: boolean;
    flipY: boolean;
    scale?: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('画像を読み込めませんでした'));
        image.src = src;
    });
}

export async function renderTransformedImageBlob(
    imageSrc: string,
    transform: ImageTransform,
): Promise<Blob> {
    const image = await loadImage(imageSrc);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const angle = (transform.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const canvas = document.createElement('canvas');

    canvas.width = Math.max(1, Math.ceil(width * cos + height * sin));
    canvas.height = Math.max(1, Math.ceil(width * sin + height * cos));

    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('画像変換用 canvas を作成できませんでした');
    }

    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(angle);
    context.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
    context.drawImage(image, -width / 2, -height / 2);

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error('画像変換に失敗しました'));
            }
        }, 'image/png');
    });
}
