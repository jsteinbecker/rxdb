-- What one container delivers when its label says the printed strength includes an overfill.
ALTER TABLE "product_ingredient" ADD COLUMN "delivered_num_mag" DECIMAL;
ALTER TABLE "product_ingredient" ADD COLUMN "delivered_num_uom" TEXT;
