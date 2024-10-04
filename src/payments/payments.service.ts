import { Inject, Injectable } from '@nestjs/common';
import { envs, NATS_SERVICE } from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payment-session.dto';
import { Request, Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class PaymentsService {
    constructor(
        @Inject(NATS_SERVICE)
        private readonly client: ClientProxy
    ){}


    private readonly stripe = new Stripe(envs.stripeSecret); 


    async createPaymentSession( paymentSessionDto: PaymentSessionDto){
        const {currency, items, orderId} = paymentSessionDto;

        const line_items = items.map(item=>{
            return {
                price_data:{
                    currency,
                    product_data:{
                        name: item.name
                    },
                    unit_amount: Math.round(item.price * 100),
                },
                quantity: item.quantity
            }
        });

        const session = await this.stripe.checkout.sessions.create({
            payment_intent_data:{
                metadata:{orderId}, 
            },
            line_items: line_items,
            mode: 'payment',
            success_url: envs.stripeSucceesUrl,
            cancel_url: envs.stripeCancelUrl,
        });

        return session;
    }



    async stripeWebhook(req: Request, res: Response){
        const sig = req.headers['stripe-signature']
        
        let event: Stripe.Event;
        
        const endpointSecret = envs.stripeEndpointSecret;


        try{
            event = event = this.stripe.webhooks.constructEvent(req['rawBody'], sig, endpointSecret);
        }catch(error){
            res.status(400).send(`Webhook Error: ${error.message}`);
        }

        switch(event.type){
            case "charge.succeeded":
                const chargeSucceeded = event.data.object;
                
                const payload = {
                    stripePaymentId: chargeSucceeded.id,
                    orderId: chargeSucceeded.metadata.orderId,
                    receiptUrl: chargeSucceeded.receipt_url
                }
                this.client.emit('payment.succeeded', payload)
            break;

            default:
                break;
        }


        return res.status(200).json({sig})
    }
}
