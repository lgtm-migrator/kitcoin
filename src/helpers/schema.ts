import mongoose from 'mongoose';
import {mongo as mongoURL, weeklyBalance} from '../config/keys.json';
import {
	IUserQueries,
	UserRoles,
	UserRoleTypes,
	ITransactionAPIResponse,
	ITransactionDoc,
	IUserDoc,
	IUserModel,
	ITransactionModel,
	ITransactionQueries,
	ITransaction,
	IStoreDoc,
	IStoreModel,
	IStoreQueries,
	IStoreItem,
	IStoreItemQueries,
	IStoreItemMethods,
	IStoreItemsQuery,
	IStoreItemDoc,
	IStoreItemModel,
} from '../types';

import fuzzySearch from 'mongoose-fuzzy-searching';

mongoose.connect(mongoURL);

const userSchema = new mongoose.Schema<IUserDoc, IUserModel>({
	email: String,
	googleID: {
		type: String,
		required: true,
	},
	schoolID: {
		type: String,
	},
	name: {
		type: String,
	},
	balance: {
		type: Number,
		get: getBalance,
		default: 0,
	},
	balanceExpires: {
		type: Date,
	},
	tokens: {
		refresh: {
			type: String,
			default: null,
		},
		access: {
			type: String,
			default: null,
		},
		expires: {
			type: Date,
			default: null,
		},
		session: {
			type: String,
			default: null,
		},
		scopes: {
			type: [String],
			default: [],
		},
	},
	roles: {type: Number, default: UserRoles.STUDENT},
});

userSchema.index({email: 1});
userSchema.index({googleID: 1}, {unique: true});
userSchema.index({bySchoolId: 1}, {unique: true});

userSchema.query.byEmail = function (email: string): IUserQueries {
	return this.where({email});
};

userSchema.query.byId = function (googleID: string): IUserQueries {
	return this.where({googleID});
};

userSchema.query.bySchoolId = function (schoolID: string): IUserQueries {
	return this.where({schoolID});
};

userSchema.query.byToken = function (token: string): IUserQueries {
	return this.where({'tokens.session': token});
};

userSchema.methods.setRoles = function (roles: UserRoleTypes[]): void {
	this.roles = roles.reduce((acc, role) => acc | UserRoles[role], 0);
	return;
};

userSchema.methods.getRoles = function (): UserRoleTypes[] {
	return Object.keys(UserRoles)
		.map(x => x as UserRoleTypes)
		.filter(role => this.hasRole(role));
};

userSchema.methods.hasRole = function (role: UserRoleTypes): boolean {
	return (this.roles & UserRoles[role]) === UserRoles[role];
};

userSchema.methods.hasAnyRole = function (roles: UserRoleTypes[]): boolean {
	return roles.some(role => this.hasRole(role));
};

userSchema.methods.hasAllRoles = function (roles: UserRoleTypes[]): boolean {
	return roles.every(role => this.hasRole(role));
};

function getBalance(this: IUserDoc, balance: number) {
	if (!this.hasRole('STAFF')) return balance;
	if (
		!this.balanceExpires ||
		this.balanceExpires.getDate() < new Date().getDate()
	) {
		this.balanceExpires = new Date(
			new Date().getFullYear(),
			new Date().getMonth(),
			new Date().getDate() + 7 - new Date().getDay(),
		); // end of week
		this.balance = weeklyBalance;
		return weeklyBalance;
	}
	return balance;
}

userSchema.plugin(fuzzySearch, {
	fields: [
		{
			name: 'name',
			weight: 3,
		},
		{
			name: 'email',
			weight: 1,
			prefixOnly: true,
		},
	],
});

const transactionSchema = new mongoose.Schema<
	ITransactionDoc,
	ITransactionModel
>({
	amount: {
		type: Number,
		required: true,
	},
	reason: String,
	from: {
		id: String,
		text: String,
	},
	to: {
		id: String,
		text: String,
	},
	date: {
		type: Date,
		default: () => new Date(),
	},
});

transactionSchema.query.byUser = function (
	id: string,
	{
		count,
		page,
		search,
	}: {
		count: number | null;
		page: number | null;
		search: string | null;
	},
): ITransactionQueries {
	count ??= 10;
	page ??= 1;

	let searchOptions = search
		? {$or: [{reason: {$regex: search, $options: 'i'}}]}
		: {};

	return this.where({$or: [{'from.id': id}, {'to.id': id}], ...searchOptions})
		.sort({
			date: -1,
		})
		.limit(count)
		.skip(count * (page - 1));
};

transactionSchema.index({user: -1});

transactionSchema.methods.getUserText = async function (
	which: 'FROM' | 'TO',
): Promise<string | null> {
	let data = which === 'FROM' ? this.from : this.to;

	return (
		data.text || (data.id && (await User.findById(data.id))?.name) || null
	);
};

transactionSchema.methods.toAPIResponse = async function (
	user?: IUserDoc,
): Promise<ITransactionAPIResponse> {
	let json: Omit<ITransaction, 'date'> = this.toJSON();

	let res: ITransactionAPIResponse = {
		...json,
		date: this.date.toISOString(),
		canManage:
			(user &&
				(user.hasRole('ADMIN') ||
					(user.hasRole('STAFF') &&
						user.id === this.from.id &&
						this.date.getTime() >
							Date.now() - 1000 * 60 * 60 * 24))) ||
			false,
	};

	if (res.from.id && !res.from.text) {
		res.from.text = (await this.getUserText('FROM')) || null;
		if (user) res.from.me = user.id === res.from.id;
	}

	if (res.to.id && !res.to.text) {
		res.to.text = (await this.getUserText('TO')) || null;
		if (user) res.to.me = user.id === res.to.id;
	}

	return res;
};

const storeSchema = new mongoose.Schema<IStoreDoc, IStoreModel>({
	name: {type: String, required: true},
	description: String,
	classIDs: [String],
	public: {
		type: Boolean,
		default: false,
		required: true,
	},
	managers: [String],
	users: [String],
});

storeSchema.query.byClassCode = function (classCode: string): IStoreQueries {
	return this.where({classIDs: classCode});
};

storeSchema.methods.getItems = async function (): Promise<IStoreItemDoc[]> {
	return await StoreItem.where({storeID: this.id});
};

storeSchema.index({classIDs: 1});

const storeItemSchema = new mongoose.Schema<IStoreItemDoc, IStoreItemModel>({
	storeID: {type: String, required: true},
	name: {type: String, required: true},
	quantity: Number,
	description: {type: String, default: ''},
	price: Number,
	imageHash: String,
});

storeItemSchema.query.byStoreID = function (storeID: string): IStoreItemsQuery {
	return this.where({storeID});
};

storeItemSchema.methods.getStore =
	async function (): Promise<IStoreDoc | null> {
		return await Store.findById(this.storeID);
	};

storeItemSchema.index({storeID: 1});

const User = mongoose.model<IUserDoc, IUserModel>('User', userSchema);
const Transaction = mongoose.model<ITransactionDoc, ITransactionModel>(
	'Transaction',
	transactionSchema,
);
const Store = mongoose.model<IStoreDoc, IStoreModel>('Store', storeSchema);
const StoreItem = mongoose.model<IStoreItemDoc, IStoreItemModel>(
	'StoreItem',
	storeItemSchema,
);

export {User, Transaction, Store, StoreItem};
export * from '../types';
