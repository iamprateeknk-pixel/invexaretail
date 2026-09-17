import { type LocationRecord } from '../repository.js';
export declare function provisionOperationalTenant(input: {
    companyId: string;
    companyName: string;
    admin: {
        id: string;
        email: string;
        name: string;
        passwordHash: string;
    };
}): Promise<{
    location: LocationRecord;
}>;
