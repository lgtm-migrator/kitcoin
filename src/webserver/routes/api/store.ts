import express from 'express';
import {ClassroomClient} from '../../../helpers/classroom';
import {request, validate, validators} from '../../../helpers/request';
import {IStoreDoc, IUserDoc, Store} from '../../../helpers/schema';
const router = express.Router();

async function getStorePerms(
	store: IStoreDoc,
	user: IUserDoc,
): Promise<{
	view: boolean;
	manage: boolean;
}> {
	let view = false,
		manage = false,
		classroomClient = await new ClassroomClient().createClient(user);

	if (user.hasRole('ADMIN')) {
		manage = true;
	} else if (store.managers.includes(user.id)) {
		manage = true;
	} else if (store.classID && classroomClient) {
		const teaching = await classroomClient
			.getClassesForRole('TEACHER')
			.then(x => (x || []).map(x => x.id));

		if (teaching.includes(store.classID)) manage = true;
	}

	if (manage)
		return {
			view: true,
			manage,
		};

	if (store.public) {
		view = true;
	} else if (store.classID && classroomClient) {
		const classes = await classroomClient
			.getClassesForRole('STUDENT')
			.then(x => (x || []).map(x => x.id));

		if (classes.includes(store.classID)) view = true;
	}

	return {view, manage};
}

router.get(
	'/store/:id',
	async (req, res, next) =>
		request(req, res, next, {
			authentication: true,
		}),
	(req, res, next) =>
		validate(req, res, next, {
			params: {
				id: validators.string,
			},
		}),
	async (req, res) => {
		try {
			if (!req.user) return;

			const {id} = req.params;

			const store = await Store.findById(id)
				.then(store => {
					if (!store) {
						res.status(404).send('Store not found');
						return null;
					}
					return store;
				})
				.catch(() => {
					res.status(400).send('Invalid ID');
					return null;
				});

			if (!store) return;

			const permissions = await getStorePerms(store, req.user);
			if (!permissions.view) return res.status(403).send('Forbidden');

			const {name, description} = store;

			const items = await store.getItems();

			return res.status(200).send({
				name,
				description,
				canManage: permissions.manage,
				items,
			});
		} catch (e) {
			try {
				res.status(500).send('Something went wrong.');
			} catch (e) {}
		}
	},
);

router.post(
	'/storeitem',
	async (req, res, next) =>
		request(req, res, next, {
			authentication: true,
		}),
	(req, res, next) =>
		validate(req, res, next, {
			body: {
				storeID: validators.string,
				name: validators.string,
				description: validators.string,
				price: validators.number,
				quantity: validators.optional(validators.number),
			},
		}),
	async (req, res) => {
		try {
			if (!req.user) return;

			const {body} = req;

			const {storeID, name, quantity, description, price} = body;

			const store = await Store.findById(storeID)
				.then(store => {
					if (!store) {
						res.status(404).send('Store not found');
						return null;
					}
					return store;
				})
				.catch(() => {
					res.status(400).send('Invalid ID');
					return null;
				});

			if (!store) return;

			const permissions = await getStorePerms(store, req.user);
			if (!permissions.manage) return res.status(403).send('Forbidden');
		} catch (e) {}
	},
);

export default router;
