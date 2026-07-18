import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsEnum,
  IsOptional,
  ValidateNested,
  ValidateIf,
  IsMongoId,
  IsBoolean,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';

export function IsAddressAllowedForMethod(
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAddressAllowedForMethod',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const obj = args.object as any;
          if (
            obj.deliveryMethod === 'Store Pickup' &&
            value !== undefined &&
            value !== null
          ) {
            return false;
          }
          if (
            obj.deliveryMethod === 'Home Delivery' &&
            (value === undefined || value === null)
          ) {
            return false;
          }
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          const obj = args.object as any;
          if (obj.deliveryMethod === 'Store Pickup') {
            return 'deliveryAddress must be omitted/null when deliveryMethod is Store Pickup';
          }
          return 'deliveryAddress is required when deliveryMethod is Home Delivery';
        },
      },
    });
  };
}

export class DeliveryAddressDto {
  @IsMongoId()
  @IsOptional()
  addressId?: string;

  @ValidateIf((o) => !o.addressId)
  @IsString()
  @IsNotEmpty()
  street?: string;

  @ValidateIf((o) => !o.addressId)
  @IsString()
  @IsNotEmpty()
  city?: string;

  @ValidateIf((o) => !o.addressId)
  @IsString()
  @IsNotEmpty()
  country?: string;
}

export class CreateOrderDto {
  @IsEnum(['Home Delivery', 'Store Pickup'])
  @IsNotEmpty()
  deliveryMethod!: string;

  @IsAddressAllowedForMethod()
  @ValidateIf(
    (o) =>
      o.deliveryMethod === 'Home Delivery' || o.deliveryAddress !== undefined,
  )
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress!: DeliveryAddressDto;

  @IsString()
  @IsOptional()
  specialNotes?: string;

  @IsEnum(['Cash on Delivery'])
  @IsNotEmpty()
  paymentMethod!: string;

  @IsBoolean()
  @IsOptional()
  saveAddress?: boolean;
}
