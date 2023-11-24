import {
  DeleteObjectsCommand,
  DeleteObjectsCommandOutput,
  PutObjectCommand,
  PutObjectCommandInput,
  S3Client,
  CreateMultipartUploadCommand,
  ObjectCannedACL,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import sharp from "sharp";
import { injectable } from "inversify";
import { v4 as uuidv4 } from "uuid";
import { FixedSize } from "../utils/fixed-types";

@injectable()
export class S3Service {
  s3: S3Client;
  s3Acceleration: S3Client;
  constructor() {
    this.s3 = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
      },
      signingRegion: process.env.AWS_REGION,
    });
    this.s3Acceleration = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
      },
      signingRegion: process.env.AWS_REGION,
      useAccelerateEndpoint: true,
    });
  }

  async uploadImage(
    file: Express.Multer.File,
    useWatermark = false
  ): Promise<string> {
    const name = uuidv4();
    const now = new Date();
    const month = ("0" + (now.getMonth() + 1)).slice(-2);
    const day = ("0" + now.getDate()).slice(-2);
    const image = sharp(file.buffer);
    const metadata = await image.metadata();
    const width =
      metadata.width >= FixedSize.LARGE
        ? FixedSize.LARGE
        : metadata.width >= FixedSize.MEDIUM
        ? FixedSize.MEDIUM
        : FixedSize.SMALL;
    const buffer = useWatermark
      ? await image
          .composite([
            {
              // input: `${path.resolve(__dirname)}/watermark_${width}.png`,
              input: `${path.dirname(path.resolve(__dirname))}/watermark/watermark_${width}.png`,
              gravity: "southeast",
            },
          ])
          .toBuffer()
      : await image.toBuffer();
    return this.pubObject({
      Body: buffer,
      Key: `${now.getFullYear()}/${month}/${day}/${name}${path.extname(
        file.originalname
      )}`,
      ContentType: metadata.format && `image/${metadata.format.toLowerCase()}`,
    });
  }

  async optimizeAndUploadImage(
    file: Express.Multer.File,
    widths: FixedSize[],
    useWatermark = false
  ): Promise<Array<string>> {
    const name = uuidv4();
    const now = new Date();
    const month = ("0" + (now.getMonth() + 1)).slice(-2);
    const day = ("0" + now.getDate()).slice(-2);
    const originalKey = `${now.getFullYear()}/${month}/${day}/${name}${path.extname(
      file.originalname
    )}`;
    const originalImage = sharp(file.buffer);
    const metadata = await originalImage.metadata();
    const width =
      metadata.width >= FixedSize.LARGE
        ? FixedSize.LARGE
        : metadata.width >= FixedSize.MEDIUM
        ? FixedSize.MEDIUM
        : FixedSize.SMALL;
    const originalBuffer = await (useWatermark
      ? originalImage.composite([
          {
            // input: `${path.resolve(__dirname)}/watermark_${width}.png`,
            input: `${path.dirname(path.resolve(__dirname))}/watermark/watermark_${width}.png`,
            gravity: "southeast",
          },
        ])
      : originalImage
    ).toBuffer();
    const uploadPromises: Array<Promise<string>> = [
      this.pubObject({
        Body: originalBuffer,
        Key: originalKey,
        ContentType: metadata.format && `image/${metadata.format}`,
      }),
    ];
    await Promise.all(
      widths.map(async (width) => {
        let image: sharp.Sharp = sharp(file.buffer).resize(width, null, {
          fit: "contain",
        });
        if (useWatermark) {
          image = image.composite([
            {
              // input: `${path.resolve(__dirname)}/watermark_${width}.png`,
              input: `${path.dirname(path.resolve(__dirname))}/watermark/watermark_${width}.png`,
              gravity: "southeast",
            },
          ]);
        }
        return image.toBuffer();
      })
    ).then((buffers) =>
      buffers.forEach((buffer, index) => {
        const key = `${now.getFullYear()}/${month}/${day}/${name}_${
          // eslint-disable-next-line security/detect-object-injection
          widths[index]
        }${path.extname(file.originalname)}`;
        uploadPromises.push(
          this.pubObject({
            Body: buffer,
            Key: key,
            ContentType: metadata.format && `image/${metadata.format}`,
          })
        );
      })
    );
    return Promise.all(uploadPromises);
  }

  async uploadFile(file: Express.Multer.File): Promise<string> {
    const name = uuidv4();
    const now = new Date();
    const month = ("0" + (now.getMonth() + 1)).slice(-2);
    const day = ("0" + now.getDate()).slice(-2);
    const buffer = file.buffer;

    const pubOject = {
      Body: buffer,
      Key: `${
        process.env.S3_IMAGE_WATCHFOLDER_PREFIX
      }/${now.getFullYear()}/${month}/${day}/${name}${path.extname(
        file.originalname
      )}`,
      ContentType: file.mimetype,
    } as Pick<
      PutObjectCommandInput,
      "Key" | "Body" | "ContentType" | "ContentDisposition"
    >;

    if (
      file.mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      pubOject.ContentDisposition = `attachment; filename="${encodeURIComponent(
        file.originalname
      )}"`;
    }
    return this.pubObject(pubOject);
  }

  private async pubObject(
    input: Pick<
      PutObjectCommandInput,
      "Key" | "Body" | "ContentType" | "ContentDisposition"
    >
  ): Promise<string> {
    return this.s3
      .send(
        new PutObjectCommand({
          Bucket: process.env.S3_IMAGE_BUCKET,
          ...input,
        })
      )
      .then(() => {
        return `${process.env.CLOUD_FRONT_IMAGE_DOMAIN}/${input.Key}`;
      });
  }

  deleteObjects(
    urls: string[],
    widths?: FixedSize[]
  ): Promise<DeleteObjectsCommandOutput> {
    return this.s3.send(
      new DeleteObjectsCommand({
        Bucket: process.env.S3_IMAGE_BUCKET,
        Delete: {
          Objects: urls.flatMap((url) => {
            const mainKey = url.substr(url.search(/(?!\/)\w{1}\//g) + 2);
            const keys = [{ Key: mainKey }];
            if (widths?.length > 0) {
              const lastIndex = mainKey.lastIndexOf(".");
              const name = mainKey.substr(0, lastIndex);
              const extension = mainKey.substr(lastIndex);
              widths.forEach((width) =>
                keys.push({ Key: `${name}_${width}${extension}` })
              );
            }
            return keys;
          }),
          Quiet: true,
        },
      })
    );
  }

  async generatePresignedUrl(key: string): Promise<string> {
    const now = new Date();
    const month = ("0" + (now.getMonth() + 1)).slice(-2);
    const day = ("0" + now.getDate()).slice(-2);
    const command = new PutObjectCommand({
      Bucket: process.env.S3_VOD_WATCHFOLDER_BUCKET,
      Key: `${
        process.env.S3_VOD_WATCHFOLDER_PREFIX
      }/${now.getFullYear()}/${month}/${day}/${key}`,
    });
    return getSignedUrl(this.s3, command, {
      expiresIn: +process.env.S3_PRESIGNED_URL_EXPIRED_TIME,
    });
  }

  async generatePresignedUrlAcceleration(key: string): Promise<string> {
    const now = new Date();
    const month = ("0" + (now.getMonth() + 1)).slice(-2);
    const day = ("0" + now.getDate()).slice(-2);
    const command = new PutObjectCommand({
      Bucket: process.env.S3_VOD_WATCHFOLDER_BUCKET,
      Key: `${
        process.env.S3_VOD_WATCHFOLDER_PREFIX
      }/${now.getFullYear()}/${month}/${day}/${key}`,
    });
    return getSignedUrl(this.s3Acceleration, command, {
      expiresIn: +process.env.S3_PRESIGNED_URL_EXPIRED_TIME,
    });
  }

  async initializeMultipartUpload(key: string) {
    const now = new Date();
    const month = ("0" + (now.getMonth() + 1)).slice(-2);
    const day = ("0" + now.getDate()).slice(-2);

    const multipartParams = {
      Bucket: process.env.S3_VOD_WATCHFOLDER_BUCKET,
      Key: `${
        process.env.S3_VOD_WATCHFOLDER_PREFIX
      }/${now.getFullYear()}/${month}/${day}/${key}`,
      ACL: "public-read" as ObjectCannedACL,
    };

    const createUploadResponse = await this.s3.send(
      new CreateMultipartUploadCommand(multipartParams)
    );

    console.log(createUploadResponse);
  }

  // async getMultipartPreSignedUrls(uploadId: string, fileKey: string, nbParts: number) {

  //   const promises = []
  //   for (let index = 0; index < nbParts; index++) {
  //     const multipartParams = new PutObjectCommand({
  //       Bucket: process.env.S3_VOD_WATCHFOLDER_BUCKET,
  //       Key: fileKey,
  //       ACL: "public-read",
  //       // PartNumber: index + 1,
  //     })

  //     promises.push(
  //       getSignedUrl(this.s3, multipartParams,
  //         {
  //           expiresIn: +process.env.S3_PRESIGNED_URL_EXPIRED_TIME,
  //         })
  //     )
  //   }
  //   const signedUrls = await Promise.all(promises)

  //   const now = new Date();
  //   const month = ('0' + (now.getMonth() + 1)).slice(-2);
  //   const day = ('0' + now.getDate()).slice(-2);

  //   const command = new PutObjectCommand({
  //     Bucket: process.env.S3_VOD_WATCHFOLDER_BUCKET,
  //     Key: `${process.env.S3_VOD_WATCHFOLDER_PREFIX
  //       }/${now.getFullYear()}/${month}/${day}/${key}`,
  //   });

  //   return getSignedUrl(this.s3, command, {
  //     expiresIn: +process.env.S3_PRESIGNED_URL_EXPIRED_TIME,
  //   });
  // }
}
