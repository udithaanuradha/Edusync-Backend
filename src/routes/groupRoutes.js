const express = require('express');
const router = express.Router();
const {
	getGroupsByLevel,
	createGroup,
	getCoordinatorApprovedRequests,
	updateGroup,
	deleteGroup,
} = require('../controllers/groupController');

router.get('/level/:level', getGroupsByLevel);
router.post('/create', createGroup);
router.put('/:id', updateGroup);
router.put('/update/:id', updateGroup);
router.delete('/:id', deleteGroup);
router.delete('/delete/:id', deleteGroup);
router.get('/coordinator/approved', getCoordinatorApprovedRequests);

module.exports = router;
