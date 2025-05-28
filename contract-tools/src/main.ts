import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common'; // Import ValidationPipe
import { Logger } from '@nestjs/common'; // Optional: for logging

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap'); // Optional

  // Enable global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Strips properties not defined in DTO
    transform: true, // Transforms payload to DTO instance (e.g., string to number)
    forbidNonWhitelisted: true, // Optional: throws error if non-whitelisted properties are present
    transformOptions: {
      enableImplicitConversion: true, // Optional: allows implicit conversion of types
    },
  }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Application listening on port ${port}`); // Optional
}
bootstrap();
