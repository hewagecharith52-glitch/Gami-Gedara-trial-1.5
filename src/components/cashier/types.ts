export type OrderItem = {
    id: string;
    name: string;
    price: number;
    quantity: number;
    is_new?: boolean;
    prepared?: boolean;
    kot_printed?: boolean;
    added_at?: string;
    notes?: string;
};

export type OrderStatus =
    | "pending"
    | "reviewing"
    | "Preparing"
    | "Ready"
    | "completed"
    | "Completed"
    | "Pending";

export type OrderType = "dine-in" | "takeaway" | "delivery";

export type Order = {
    id: string;
    created_at: string;
    table_no: string;
    items: OrderItem[];
    total_amount: number;
    status: OrderStatus | string;
    order_type?: OrderType;
    customer_name?: string;
    payment_method?: string;
    notes?: string;
    discount?: number;
    settled_by?: string;
};